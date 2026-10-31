// Deployment preflight (SEC-04): node api/src/config-check-cli.js [.env]   -> exit 1 and a list of problems when the .env is not safe for production.
// Run it BEFORE `docker compose up` (see docs/DEPLOYMENT.md). It never prints a secret value. Also checks the file permissions of the .env.
import fs from 'node:fs';
import { validateDeployEnv } from './security.js';
const file = process.argv[2] || '.env';
let text; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { console.error(`config-check: cannot read ${file}: ${e.code}`); process.exit(2); }
const env = {}; for (const l of text.split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); }
const problems = validateDeployEnv(env);
try { const mode = fs.statSync(file).mode & 0o777; if (process.platform !== 'win32' && (mode & 0o077)) problems.push(`${file} is readable by other users (mode ${mode.toString(8)}); run: chmod 600 ${file}`); } catch { /* ignore */ }
if (problems.length) { console.error('config-check: NOT SAFE FOR PRODUCTION\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('config-check: OK (all secrets present, strong, distinct, non-default; NODE_ENV=production)');
