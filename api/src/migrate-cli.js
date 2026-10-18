// One-shot upgrade runner (compose service `migrate`). Holds the owner credential so the API container never needs it.
import { migrate } from './migrate.js';
const log = { info: m => console.log('[migrate]', m), warn: m => console.warn('[migrate]', m), error: m => console.error('[migrate]', m) };
const r = await migrate({ ownerUrl: process.env.OWNER_DATABASE_URL, root: process.env.ERPX_ROOT || '/app', log });
if (r.error) log.error(`DATABASE UPGRADE FAILED (nothing was changed by the failing step): ${r.error}. Demo data only: 'docker compose down -v' then 'docker compose up -d --build'.`);
else if (r.applied?.length) log.warn(`database upgraded automatically: ${r.applied.join(', ')}`);
else log.info(r.ran ? 'database already up to date' : 'skipped: ' + r.reason);
if (r.missing?.length) log.error(`SCHEMA CHECK: still missing -> ${r.missing.join(', ')}. Send me this line.`); else if (r.missing) log.info('schema check: all expected tables and columns exist');
process.exit(0);   // never blocks the API: /api/health and the 503 messages report an outdated schema
