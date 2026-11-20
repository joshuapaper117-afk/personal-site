import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

interface SiteStackProps extends cdk.StackProps {
  githubRepo: string; // "owner/repo"
  // Newer GitHub repos use immutable OIDC subjects: "repo:owner@ID/repo@ID".
  githubSubjectPrefix?: string;
}

export class SiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    // Private bucket; only CloudFront can read it.
    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    // Astro emits /builds/foo/index.html; map directory-style URLs to it.
    const rewrite = new cloudfront.Function(this, 'IndexRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var r = event.request;
  if (r.uri.endsWith('/')) r.uri += 'index.html';
  else if (!r.uri.split('/').pop().includes('.')) r.uri += '/index.html';
  return r;
}`),
    });

    // Admin API: a Lambda that checks the password and commits build edits to GitHub.
    // Secrets live in SSM (SecureString), created out-of-band: see README "Admin".
    const paramPrefix = '/personal-site/admin';
    const adminFn = new lambda.Function(this, 'AdminFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'admin.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.seconds(20),
      memorySize: 256,
      environment: { GITHUB_REPO: props.githubRepo, GITHUB_BRANCH: 'main', PARAM_PREFIX: paramPrefix },
    });
    adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${paramPrefix}/*`],
    }));
    const adminUrl = adminFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    const dist = new cloudfront.Distribution(this, 'Dist', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: rewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.FunctionUrlOrigin(adminUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html' },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html' },
      ],
    });

    // GitHub Actions deploys via OIDC: no long-lived AWS keys stored in GitHub.
    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    const deployRole = new iam.Role(this, 'DeployRole', {
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${props.githubRepo}:ref:refs/heads/main`,
            ...(props.githubSubjectPrefix ? [`${props.githubSubjectPrefix}:ref:refs/heads/main`] : []),
          ],
        },
      }),
    });
    bucket.grantReadWrite(deployRole);
    bucket.grantDelete(deployRole);
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:aws:cloudfront::${this.account}:distribution/${dist.distributionId}`],
    }));

    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${dist.distributionDomainName}` });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: dist.distributionId });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
