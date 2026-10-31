// One-shot upgrade runner (compose service `migrate`). Holds the owner credential so the API container never needs it.
import { migrate } from './migrate.js';
const log = { info: m => console.log('[migrate]', m), warn: m => console.warn('[migrate]', m), error: m => console.error('[migrate]', m) };
const r = await migrate({ ownerUrl: process.env.OWNER_DATABASE_URL, root: process.env.ERPX_ROOT || '/app', log });
if (r.error) log.error(`DATABASE UPGRADE FAILED (nothing was changed by the failing step): ${r.error}. Demo data only: 'docker compose down -v' then 'docker compose up -d --build'.`);
else if (r.applied?.length) log.warn(`database upgraded automatically: ${r.applied.join(', ')}`);
else log.info(r.ran ? 'database already up to date' : 'skipped: ' + r.reason);
if (r.missing?.length) log.error(`SCHEMA CHECK: still missing -> ${r.missing.join(', ')}. Send me this line.`); else if (r.missing) log.info('schema check: all expected tables and columns exist');
// DB-02: a failed or incomplete upgrade must STOP the stack: docker-compose starts the api only after this one-shot service completes
// successfully (service_completed_successfully), so a non-zero exit keeps the api down instead of serving on a half-upgraded schema.
// Escape hatch for an operator who consciously accepts it: MIGRATE_ALLOW_FAILURE=1 (the api then reports the state via /api/health and 503s).
const badTenants = (r.tenants || []).filter(t => !t.ok);
if (r.tenants) log.info(`tenants: ${r.tenants.length - badTenants.length} up to date${badTenants.length ? ', FAILED: ' + badTenants.map(t => t.slug).join(', ') : ''}`);
const bad = badTenants.length > 0 || Boolean(r.error) || Boolean(r.missing?.length) || (r.ran === false && /cannot connect/.test(r.reason || ''));
process.exit(bad && process.env.MIGRATE_ALLOW_FAILURE !== '1' ? 1 : 0);
