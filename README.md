# Personal site

Astro static site → S3 + CloudFront (CDK in `infra/`) → deployed by GitHub Actions on push to `main`.

## Add a build
Floating an idea: add `src/content/ideas/<name>.md` (title, summary, stage). When it becomes real, move it to builds.

Add a build: create `src/content/builds/<name>.md` with frontmatter (title, summary, date, status, tags, repo). Push to `main`.

## One-time setup
1. `cd infra && npx cdk bootstrap && npx cdk deploy` (repo name is set in `infra/cdk.json``
2. In GitHub repo → Settings → Secrets → Actions, add the stack outputs:
   `AWS_DEPLOY_ROLE_ARN`, `SITE_BUCKET`, `CF_DISTRIBUTION_ID`.
3. Push to `main`; the site is live at the `SiteUrl` output.
4. Put your CV at `public/cv.pdf` and fill in `src/pages/cv.astro`.
5. Optional: custom domain (Route 53 + ACM cert in us-east-1) and set `site` in `astro.config.mjs`.

## Local
`npm install && npm run dev`
