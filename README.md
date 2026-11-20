# Personal site

Astro static site → S3 + CloudFront (CDK in `infra/`) → deployed by GitHub Actions on push to `main`.

## Add a build
Add a build: create `src/content/builds/<name>.md` with frontmatter (title, summary, date, status, tags). Push to `main`.

## One-time setup
1. `cd infra && npx cdk bootstrap && npx cdk deploy` (repo name is set in `infra/cdk.json`)
2. In GitHub repo → Settings → Secrets → Actions, add the stack outputs:
   `AWS_DEPLOY_ROLE_ARN`, `SITE_BUCKET`, `CF_DISTRIBUTION_ID`.
3. Push to `main`; the site is live at the `SiteUrl` output.
4. Put your CV at `public/cv.pdf` and fill in `src/pages/cv.astro`.
5. Optional: custom domain (Route 53 + ACM cert in us-east-1) and set `site` in `astro.config.mjs`.

## Local
`npm install && npm run dev`

## Admin (add/edit builds from the browser)
Hidden page at `/admin/` (no link anywhere, `noindex`). Sign in with one password; saving commits the
markdown file to GitHub, and the deploy workflow rebuilds the site (~2 min). API = Lambda behind CloudFront `/api/*`.

One-time setup:
1. Create a GitHub fine-grained token: only this repo, permission **Contents: read and write**.
2. Store it: `aws ssm put-parameter --region us-east-1 --type SecureString --name /personal-site/admin/github-token --value <token>`
3. Set the password (prompts, hidden; stores only a hash): `node infra/scripts/set-password.mjs`
4. `cd infra && npx cdk deploy`, then push so the `/admin/` page is deployed.

Change the password any time by re-running step 3 (it also signs out existing sessions).
