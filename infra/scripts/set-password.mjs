// Run locally: node scripts/set-password.mjs
// Prompts for the admin password (hidden), stores only a scrypt hash in SSM, and creates
// the session key if it doesn't exist. The password itself is never written anywhere.
import { scryptSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const PREFIX = process.env.PARAM_PREFIX || '/personal-site/admin';
const REGION = 'us-east-1';

function ask(q) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    const { stdin } = process;
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let v = '';
    stdin.on('data', function on(c) {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); return resolve(v); }
        if (ch === '\u0003') process.exit(1);
        if (ch === '\u007f') v = v.slice(0, -1); else v += ch;
      }
    });
  });
}
const put = (name, value) => execFileSync('aws', ['ssm', 'put-parameter', '--region', REGION, '--name', `${PREFIX}/${name}`, '--type', 'SecureString', '--overwrite', '--value', value], { stdio: ['ignore', 'ignore', 'inherit'] });

const a = await ask('New admin password (min 14 chars): ');
const b = await ask('Repeat it: ');
if (a !== b) { console.error('Passwords differ.'); process.exit(1); }
if (a.length < 14) { console.error('Too short: use at least 14 characters (a few random words is fine).'); process.exit(1); }
const N = 16384, salt = randomBytes(16);
const hash = scryptSync(a, salt, 32, { N, r: 8, p: 1 });
put('password-hash', `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`);
put('session-key', randomBytes(32).toString('base64')); // also signs out any old sessions
console.log('Password set. Existing sessions are signed out.');
