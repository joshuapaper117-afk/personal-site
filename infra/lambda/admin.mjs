// Admin API for the personal site. Sits behind CloudFront at /api/*.
// Edits are committed to GitHub; the existing deploy workflow rebuilds the site.
//
// NOTE: CloudFront maps 403/404 responses to the site's 404 page for the whole
// distribution, so this API never returns 403 or 404 (it uses 401 / 400 / 409 / 502).
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { scryptSync, timingSafeEqual, createHmac, randomBytes } from 'node:crypto';

const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const PREFIX = process.env.PARAM_PREFIX;
const DIR = 'src/content/builds';
const SESSION_SECONDS = 8 * 60 * 60;
const ssm = new SSMClient({});

let secrets; // cached per warm container
async function getSecrets() {
  if (secrets) return secrets;
  const names = ['password-hash', 'session-key', 'github-token'].map((n) => `${PREFIX}/${n}`);
  const r = await ssm.send(new GetParametersCommand({ Names: names, WithDecryption: true }));
  const v = Object.fromEntries(r.Parameters.map((p) => [p.Name.slice(PREFIX.length + 1), p.Value]));
  if (names.length !== r.Parameters.length) throw new Error('Admin secrets are not set up yet');
  secrets = v;
  return v;
}

const json = (status, body) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkPassword(password, stored) {
  const [scheme, n, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return timingSafeEqual(want, got);
}

const sign = (key, payload) => createHmac('sha256', key).update(payload).digest('base64url');
function makeToken(key) {
  const payload = `${Math.floor(Date.now() / 1000) + SESSION_SECONDS}.${randomBytes(8).toString('base64url')}`;
  return `${payload}.${sign(key, payload)}`;
}
function validToken(key, token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(sign(key, payload));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return false;
  return Number(payload.split('.')[0]) > Date.now() / 1000;
}

async function gh(token, path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'personal-site-admin',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) { const e = new Error(`GitHub ${res.status}`); e.gh = res.status; e.detail = data?.message; throw e; }
  return data;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function validateContent(content) {
  if (typeof content !== 'string' || content.length > 100_000) return 'Content missing or too large';
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return 'Missing frontmatter';
  const fm = m[1];
  for (const k of ['title', 'summary', 'date']) if (!new RegExp(`^${k}:\\s*\\S`, 'm').test(fm)) return `Frontmatter needs ${k}`;
  if (!/^date:\s*"?\d{4}-\d{2}-\d{2}"?\s*$/m.test(fm)) return 'date must be YYYY-MM-DD';
  const st = fm.match(/^status:\s*"?([\w-]+)"?\s*$/m);
  if (st && !['planned', 'in-progress', 'shipped'].includes(st[1])) return 'Invalid status';
  return null;
}

export const handler = async (event) => {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const s = await getSecrets();
    const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : {};

    if (path === '/api/login' && method === 'POST') {
      const ok = typeof body.password === 'string' && body.password.length < 500 && checkPassword(body.password, s['password-hash']);
      if (!ok) { await sleep(1500); return json(401, { error: 'Wrong password' }); }
      return json(200, { token: makeToken(s['session-key']), expiresIn: SESSION_SECONDS });
    }

    if (!validToken(s['session-key'], event.headers['x-admin-token'])) return json(401, { error: 'Not signed in' });

    if (path === '/api/builds' && method === 'GET') {
      const files = await gh(s['github-token'], `contents/${DIR}?ref=${BRANCH}`);
      const builds = await Promise.all(files.filter((f) => f.name.endsWith('.md')).map(async (f) => {
        const d = await gh(s['github-token'], `contents/${f.path}?ref=${BRANCH}`);
        return { slug: f.name.replace(/\.md$/, ''), sha: d.sha, content: Buffer.from(d.content, 'base64').toString('utf8') };
      }));
      return json(200, { builds });
    }

    if (path === '/api/builds' && (method === 'PUT' || method === 'DELETE')) {
      if (typeof body.slug !== 'string' || !SLUG.test(body.slug) || body.slug.length > 80) return json(400, { error: 'Bad slug' });
      const file = `${DIR}/${body.slug}.md`;
      if (method === 'PUT') {
        const bad = validateContent(body.content);
        if (bad) return json(400, { error: bad });
        const r = await gh(s['github-token'], `contents/${file}`, {
          method: 'PUT',
          body: JSON.stringify({
            message: `Admin: ${body.sha ? 'update' : 'add'} build ${body.slug}`,
            content: Buffer.from(body.content, 'utf8').toString('base64'),
            branch: BRANCH,
            ...(body.sha ? { sha: body.sha } : {}),
          }),
        });
        return json(200, { ok: true, sha: r.content.sha });
      }
      if (!body.sha) return json(400, { error: 'sha required' });
      await gh(s['github-token'], `contents/${file}`, {
        method: 'DELETE',
        body: JSON.stringify({ message: `Admin: delete build ${body.slug}`, sha: body.sha, branch: BRANCH }),
      });
      return json(200, { ok: true });
    }

    return json(400, { error: 'Unknown route' });
  } catch (e) {
    console.error(e);
    if (e.gh === 409 || e.gh === 422) return json(409, { error: 'That build changed on GitHub since you loaded it. Reload and try again.' });
    return json(502, { error: 'Something went wrong' });
  }
};
