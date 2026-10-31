// Tenant administration (owner credential required). https://oklent.net/
//   node api/src/tenant-cli.js init                                   # create the registry, register the existing data as the default company
//   node api/src/tenant-cli.js create --slug acme --name "شركة أكمي" [--admin-user admin] [--admin-password ...] [--vat 3000...3] [--cr ...] [--city ...]
//                                     [--plan standard] [--max-users 25] [--domain erp.acme.com] [--email ops@acme.com]
//   node api/src/tenant-cli.js list | verify [--slug x] | suspend --slug x [--reason ...] | resume --slug x | archive --slug x
//   node api/src/tenant-cli.js set-domain --slug x --domain erp.acme.com
// Docker:  docker compose -f docker-compose.prod.yml --profile admin run --rm tenant-admin create --slug acme --name "Acme"
import { randomBytes } from 'node:crypto';
import { connectOwner, applyPlatform, registerDefaultTenant, provisionTenant, listTenants, setStatus, verifyTenant } from './tenant-admin.js';
import { SCHEMA_EXPECTED } from './migrate.js';

const log = { info: m => console.log('[tenant]', m), warn: m => console.warn('[tenant]', m), error: m => console.error('[tenant]', m) };
const [cmd, ...rest] = process.argv.slice(2);
const opt = {}; for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) opt[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
const root = process.env.ERPX_ROOT || process.cwd();
const need = k => { if (!opt[k] || opt[k] === true) { log.error(`--${k} is required`); process.exit(2); } return String(opt[k]); };
const strongPassword = () => randomBytes(18).toString('base64url');                // 24 chars, ~144 bits

const c = await connectOwner(process.env.OWNER_DATABASE_URL).catch(e => { log.error(e.message); process.exit(2); });
let code = 0;
try {
  await applyPlatform(c, root);                                                   // idempotent: every command can rely on the registry
  switch (cmd) {
    case 'init': {
      const t = await registerDefaultTenant(c, { slug: process.env.DEFAULT_TENANT_SLUG || 'default', version: SCHEMA_EXPECTED });
      log.info(t ? `default company registered: slug=${t.slug} schema=${t.schema_name}` : 'no existing company data found in schema public (nothing to register)'); break;
    }
    case 'create': {
      const generated = !opt['admin-password'] && !process.env.TENANT_ADMIN_PASSWORD;
      const adminPassword = String(opt['admin-password'] || process.env.TENANT_ADMIN_PASSWORD || strongPassword());
      const t = await provisionTenant(c, {
        root, slug: need('slug'), name: need('name'), adminUser: String(opt['admin-user'] || 'admin'), adminPassword, schemaVersion: SCHEMA_EXPECTED,
        company: { vat_number: opt.vat || null, cr_number: opt.cr || null, city: opt.city || null, name_en: opt['name-en'] || null },
        plan: opt.plan, maxUsers: opt['max-users'] ? Number(opt['max-users']) : null, customDomain: opt.domain ? String(opt.domain).toLowerCase() : null, contactEmail: opt.email, actor: process.env.USER || 'cli', log });
      log.info(`company "${t.slug}" is ACTIVE (schema ${t.schema_name}, ${t.tables} tables)`);
      console.log(`\n  Sign-in company code : ${t.slug}\n  Admin user           : ${opt['admin-user'] || 'admin'}\n  Admin password       : ${generated ? adminPassword + '   <- shown once, change it at first login' : '(as supplied)'}\n`);
      break;
    }
    case 'list': console.table((await listTenants(c)).map(t => ({ id: t.id, slug: t.slug, name: t.name, schema: t.schema_name, status: t.status, default: t.is_default, version: t.provisioned_version, domain: t.custom_domain }))); break;
    case 'verify': {
      const all = (await listTenants(c)).filter(t => !opt.slug || t.slug === opt.slug);
      if (!all.length) { log.error('no such company'); code = 1; break; }
      for (const t of all) { const m = await verifyTenant(c, root, t); const ok = m && !m.length; log[ok ? 'info' : 'error'](`${t.slug}: ${m === null ? 'db/schema-expected.json not found' : ok ? 'schema complete' : 'MISSING ' + m.join(', ')}`); if (!ok) code = 1; }
      break;
    }
    case 'suspend': { const t = await setStatus(c, need('slug'), 'suspended', { reason: opt.reason === true ? null : opt.reason, actor: process.env.USER || 'cli' }); log.info(`${t.slug} suspended (sign-in and public pages stop within ~15 s; data is kept)`); break; }
    case 'resume': { const t = await setStatus(c, need('slug'), 'active', { actor: process.env.USER || 'cli' }); log.info(`${t.slug} active again`); break; }
    case 'archive': { const t = await setStatus(c, need('slug'), 'archived', { reason: opt.reason === true ? null : opt.reason, actor: process.env.USER || 'cli' }); log.info(`${t.slug} archived (schema ${t.schema_name} kept; export it with scripts/tenant-backup.sh before any deletion)`); break; }
    case 'set-domain': {
      const d = need('domain').toLowerCase(); if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(d)) { log.error('invalid domain'); code = 2; break; }
      const r = await c.query('UPDATE platform.tenants SET custom_domain=$2 WHERE slug=$1 RETURNING slug', [need('slug'), d]); log.info(r.rowCount ? `${r.rows[0].slug} -> ${d}` : 'no such company'); code = r.rowCount ? 0 : 1; break;
    }
    default: console.log('commands: init | create | list | verify | suspend | resume | archive | set-domain  (see the header of api/src/tenant-cli.js)'); code = cmd ? 2 : 0;
  }
} catch (e) { log.error(e.message); code = 1; }
finally { await c.end().catch(() => {}); }
process.exit(code);
