import * as cdk from 'aws-cdk-lib';
import { SiteStack } from '../lib/site-stack';

const app = new cdk.App();
new SiteStack(app, 'PersonalSite', {
  // TODO: set to your GitHub "owner/repo" so only that repo can deploy.
  githubRepo: app.node.tryGetContext('githubRepo') ?? 'YOUR-USERNAME/personal-site',
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});
