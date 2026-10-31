// Unit tests that need NO database and NO running server:   node tests/security-unit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = async f => import(pathToFileURL(path.join(root, 'api/src', f)).href);
const { CSP, assertProductionSecrets, loginGuard, validateDeployEnv } = await imp('security.js');
const { renderMarkdown } = await imp('docs-render.js');
let failed = 0; const chk = (n, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : '  → ' + x}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

// CSP: one string, two places (API for HTML it sends, nginx for static files) — they must not drift
const ng = fs.readFileSync(path.join(root, 'deploy/nginx/security-headers.conf'), 'utf8');
chk('CSP in nginx snippet equals CSP in api/src/security.js', ng.includes(`"${CSP}"`));
chk('CSP forbids inline script and framing', /script-src 'self'(;|$)/.test(CSP) && /frame-ancestors 'none'/.test(CSP) && /object-src 'none'/.test(CSP));
for (const f of ['web/index.html', 'web/shop.html']) { const h = fs.readFileSync(path.join(root, f), 'utf8');
  chk(`${f}: no inline <script> and no inline event handlers (required by the CSP)`, !/<script(?![^>]*\bsrc=)[^>]*>/i.test(h) && !/\son[a-z]+\s*=/i.test(h)); }

// production secrets
const prod = o => ({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(8) + 'Kq9vT2mZ4pLw8RdN6yUc3HfB5sGj1AeX', DATABASE_URL: 'postgres://erpx_app:Zr7Qm2LpV9xTbW4n@db:5432/erpx', ...o });
chk('production: strong secrets are accepted', !throws(() => assertProductionSecrets(prod()), /./));
chk('production: default JWT secret refused', throws(() => assertProductionSecrets(prod({ JWT_SECRET: 'dev-only-change-me' })), /JWT_SECRET/));
chk('production: "change-me" JWT secret refused even if long', throws(() => assertProductionSecrets(prod({ JWT_SECRET: 'change-me-long-random-string-change-me-long' })), /JWT_SECRET/));
chk('production: short JWT secret refused', throws(() => assertProductionSecrets(prod({ JWT_SECRET: 'abc123' })), /JWT_SECRET/));
chk('production: default DB password (erpx_app_dev) refused', throws(() => assertProductionSecrets(prod({ DATABASE_URL: 'postgres://erpx_app:erpx_app_dev@db:5432/erpx' })), /database password/));
chk('production: missing DATABASE_URL refused', throws(() => assertProductionSecrets(prod({ DATABASE_URL: '' })), /DATABASE_URL/));
chk('development: defaults still allowed (local demo)', !throws(() => assertProductionSecrets({ NODE_ENV: 'development', JWT_SECRET: 'dev-only-change-me' }), /./));

// login throttle with a fake clock
{ let t = 1_000_000; const g = loginGuard({ max: 3, windowMs: 60_000, now: () => t });
  chk('throttle: not blocked at start', g.blockedFor('1.1.1.1', 'Ali') === 0);
  g.fail('1.1.1.1', 'Ali'); g.fail('1.1.1.1', 'ali'); chk('throttle: 2 failures (case-insensitive user) not yet blocked', g.blockedFor('1.1.1.1', 'ALI') === 0);
  g.fail('1.1.1.1', 'Ali'); const w = g.blockedFor('1.1.1.1', 'ali'); chk('throttle: 3rd failure blocks with a positive wait', w > 0 && w <= 60, String(w));
  chk('throttle: another user from the same IP is not blocked', g.blockedFor('1.1.1.1', 'omar') === 0);
  chk('throttle: same user from another IP is not blocked', g.blockedFor('2.2.2.2', 'ali') === 0);
  t += 61_000; chk('throttle: block expires after the window', g.blockedFor('1.1.1.1', 'ali') === 0);
  for (let i = 0; i < 2; i++) g.fail('3.3.3.3', 'bob'); g.ok('3.3.3.3', 'bob'); g.fail('3.3.3.3', 'bob'); g.fail('3.3.3.3', 'bob'); chk('throttle: a successful sign-in resets that user counter', g.blockedFor('3.3.3.3', 'bob') === 0);
  for (let i = 0; i < 30; i++) g.fail('4.4.4.4', 'u' + i); chk('throttle: rotating user names from one IP hits the per-IP cap (10x)', g.blockedFor('4.4.4.4', 'fresh') > 0); }

// markdown: raw HTML escaped, dangerous links neutralised, normal markdown intact
{ const out = renderMarkdown('# عنوان\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[click](javascript:alert(3)) [ok](https://oklent.net/) ![i](data:text/html;base64,AAAA)\n\n`code` **bold**');
  chk('markdown: <script> and <img onerror> are escaped, not emitted', !/<script/i.test(out) && !/<img[^>]*onerror/i.test(out) && /&lt;script&gt;/.test(out), out);
  chk('markdown: javascript:/data: links are neutralised', !/javascript:/i.test(out) && !/href="data:/i.test(out) && !/src="data:/i.test(out), out);
  chk('markdown: normal formatting and https links survive', /<h1>/.test(out) && /<strong>bold<\/strong>/.test(out) && /href="https:\/\/oklent\.net\/"/.test(out)); }

// navigation file integrity
{ const nav = JSON.parse(fs.readFileSync(path.join(root, 'web/nav.json'), 'utf8')); const ids = []; for (const m of nav.mains) { ids.push('main:' + m.id); for (const s of m.secs) { ids.push('sec:' + s.id); for (const k of s.kids) ids.push(k[0]); } }
  chk('nav.json: all ids are unique', new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join());
  chk('nav.json: protected ids exist', nav.protected.every(p => ids.includes(p)) && nav.defaultDisabled.every(p => ids.includes(p)));
  const views = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'web/commerce.js'), 'utf8') + fs.readFileSync(path.join(root, 'web/dashboard.js'), 'utf8');
  const missing = ids.filter(i => !i.includes(':') && !new RegExp(`(async ${i}\\(|VIEWS\\.${i}\\s*=|\\b${i}\\s*:)`).test(views));
  chk('nav.json: every screen id has a view implementation (or is a doc: link)', missing.length === 0, missing.join()); }

// Saudi business dates (UTC+3): the UTC date is a day behind between 00:00 and 03:00 in Riyadh
{ const { riyadhToday } = await imp('dates.js');
  chk('riyadhToday: 21:30 UTC on Oct 12 is already Oct 13 in Riyadh', riyadhToday(Date.UTC(2026, 9, 12, 21, 30)) === '2026-10-13', riyadhToday(Date.UTC(2026, 9, 12, 21, 30)));
  chk('riyadhToday: 20:59 UTC is still the same Riyadh day', riyadhToday(Date.UTC(2026, 9, 12, 20, 59)) === '2026-10-12');
  chk('riyadhToday: year boundary', riyadhToday(Date.UTC(2026, 11, 31, 22, 0)) === '2027-01-01'); }
// every nav icon exists in the icon set
{ const nav = JSON.parse(fs.readFileSync(path.join(root, 'web/nav.json'), 'utf8')); const { ICON_NAMES } = await import(pathToFileURL(path.join(root, 'web/icons.js')).href);
  const bad = Object.entries(nav.icons || {}).filter(([, n]) => !ICON_NAMES.includes(n)).map(([k]) => k);
  chk('nav.json: every mapped icon name exists in icons.js', bad.length === 0, bad.join()); }
// database upgrade classifier: complete / no platform / half-upgraded are told apart by the objects that really exist
{ const { classify } = await imp('migrate.js');
  const BASE = ['company', 'accounts', 'journal_entries', 'stores', 'store_site', 'products', 'online_orders', 'vendor_bills'], PLAT = ['sa_regions', 'sa_cities', 'sa_districts', 'unit_types', 'owners', 'property_ownership', 'technicians', 'bookings', 'booking_lines', 'stock_moves'];
  const mk = (...l) => Object.fromEntries(l.flat().map(t => [t, true]));
  chk('migrate: empty database -> left to the init scripts', classify({}).state === 'empty');
  chk('migrate: 0.3/0.4 volume (no platform tables) -> pre_platform', classify(mk(BASE)).state === 'pre_platform');
  chk('migrate: complete database -> platform (nothing to add)', classify(mk(BASE, PLAT)).state === 'platform');
  chk('migrate: half-upgraded platform schema is REPAIRED (idempotent 121), not refused', classify(mk(BASE, ['sa_regions', 'sa_cities', 'sa_districts', 'unit_types'])).state === 'repair');
  chk('migrate: missing base tables is refused', classify(mk(BASE.slice(0, 3))).state === 'broken'); }

// product images: type decided from bytes, size cap, random server-side names, deletion confined to our own files
{ const U = await imp('uploads.js'); const os = await import('node:os'); const fsp = await import('node:fs/promises');
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]), png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]), gif = Buffer.from('GIF89a' + 'x'.repeat(30)), svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), html = Buffer.from('<html><script>alert(1)</script></html>');
  chk('uploads: JPEG/PNG/WebP recognised by signature', U.detectImage(jpg)?.ext === 'jpg' && U.detectImage(png)?.ext === 'png' && U.detectImage(webp)?.ext === 'webp');
  chk('uploads: GIF, SVG and HTML refused even if renamed .jpg', !U.detectImage(gif) && !U.detectImage(svg) && !U.detectImage(html));
  chk('uploads: declared Content-Type must agree with the bytes', throws(() => U.validateImage(png, 'image/jpeg'), /لا يطابق/) && U.validateImage(png, 'image/png; charset=x').ext === 'png');
  chk('uploads: 2 MB cap enforced (and empty body refused)', throws(() => U.validateImage(Buffer.concat([jpg, Buffer.alloc(U.MAX_IMAGE_BYTES)])), /2 ميجابايت/) && throws(() => U.validateImage(Buffer.alloc(0)), /لم يصل/));
  chk('uploads: isOwnUpload accepts only our UUID paths (no traversal, no external URL)', U.isOwnUpload('/uploads/products/3f2b8a52-1c0e-4a77-9d1e-0a1b2c3d4e5f.jpg') && !U.isOwnUpload('/uploads/products/../../etc/passwd') && !U.isOwnUpload('https://x.com/a.jpg') && !U.isOwnUpload('/uploads/products/a.jpg') && !U.isOwnUpload('/uploads/products/3f2b8a52-1c0e-4a77-9d1e-0a1b2c3d4e5f.svg'));
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'erpx-up-')); const url = await U.saveProductImage(png, dir);
  chk('uploads: saved under /uploads/products/<uuid>.png and exists on disk', /^\/uploads\/products\/[0-9a-f-]{36}\.png$/.test(url) && (await fsp.stat(path.join(dir, 'products', path.basename(url)))).size === png.length);
  const outside = path.join(dir, 'keep.txt'); await fsp.writeFile(outside, 'x'); await U.removeUpload('/uploads/products/../keep.txt', dir); await U.removeUpload('https://x.com/a.png', dir);
  chk('uploads: removeUpload ignores foreign paths, deletes our own file', (await fsp.stat(outside)).size === 1 && (await U.removeUpload(url, dir)) === true && !(await fsp.stat(path.join(dir, 'products', path.basename(url))).catch(() => null)));
  await fsp.rm(dir, { recursive: true, force: true });
  const ng2 = ['default.conf', 'erpx-locations.conf'].map(f => fs.readFileSync(path.join(root, 'deploy/nginx', f), 'utf8')).join('\n'), dc = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  chk('deploy: nginx allows a >1m body ONLY on the image route; /uploads proxied; compose mounts a persistent volume', /products\/\[0-9\]\+\/image\$ \{[^}]*client_max_body_size 3m/.test(ng2) && [...ng2.matchAll(/client_max_body_size\s+(\d+)([km])/g)].every(m => m[2] === 'k' || Number(m[1]) <= 1 || m[0].endsWith('3m')) && (ng2.match(/client_max_body_size 3m/g) || []).length === 1 && /location \/uploads\//.test(ng2) && /erpx_uploads:\/app\/uploads/.test(dc) && /^  erpx_uploads:/m.test(dc)); }

// invoice print: ZATCA phase-1 elements for the tax invoice (B2B), the simplified invoice (B2C) and notes
{ const { renderInvoiceHtml, fmt } = await imp('invoice-print.js');
  const co = { name_ar: 'شركة <b>x</b>', name_en: 'Co', vat_number: '300000000000003', cr_number: '1010000000', building_no: '1', street: 'الملك فهد', district: 'العليا', city: 'الرياض', postal_code: '12211' };
  const lines = [{ line_no: 1, description: '<img src=x onerror=alert(1)>', qty: '2.0000', unit_price: '300.0000', discount: '20.00', net: '580.00', vat: '87.00', vat_rate: '15.00' }, { line_no: 2, description: 'خدمة', qty: '1.0000', unit_price: '200.0000', discount: '0.00', net: '200.00', vat: '0.00', vat_rate: '0.00' }];
  const base = { number: 'INV-1', issue_at: '2026-10-17T21:30:05Z', supply_date: new Date(2026, 9, 17), due_date: null, icv: 5, subtotal: '780.00', vat_amount: '87.00', total: '867.00' };
  const buyer = { name_ar: 'شركة النور', vat_number: '311111111111113', street: 'التحلية', city: 'جدة' }; const qr = '<svg id="qrcode"></svg>';
  const std = renderInvoiceHtml({ i: { ...base, kind: 'standard' }, co, lines, buyer, qrSvg: qr }), sim = renderInvoiceHtml({ i: { ...base, kind: 'simplified' }, co, lines, buyer: null, qrSvg: qr });
  const cr = renderInvoiceHtml({ i: { ...base, kind: 'credit', number: 'CN-1', reason: 'إرجاع بضاعة' }, co, lines, buyer, related: { number: 'INV-1' }, qrSvg: qr });
  chk('invoice: tax invoice has bilingual title, seller + buyer name/address/VAT no.', /فاتورة ضريبية<\/h1><div>Tax Invoice/.test(std) && /300000000000003/.test(std) && /311111111111113/.test(std) && /التحلية/.test(std) && /الرياض/.test(std));
  chk('invoice: lines show discount, taxable amount, VAT %, VAT amount and line total incl. VAT (580.00+87.00=667.00)', /<td class="m">20\.00<\/td><td class="m">580\.00<\/td>.*?15%<\/td><td class="m">87\.00<\/td><td class="m"><b>667\.00<\/b>/.test(std) && /200\.00<\/b>/.test(std));
  chk('invoice: totals — before discount 800.00, discount 20.00, excl. VAT 780.00, VAT 87.00, incl. VAT 867.00', ['800.00', '20.00', '780.00', '87.00', '867.00 SAR'].every(x => std.includes(x)));
  chk('invoice: VAT breakdown by rate appears only with more than one rate', /الوعاء/.test(std) && !/الوعاء/.test(renderInvoiceHtml({ i: { ...base, kind: 'standard', subtotal: '580.00', vat_amount: '87.00', total: '667.00' }, co, lines: [lines[0]], buyer, qrSvg: qr })));
  chk('invoice: issue time printed in Riyadh time (21:30Z -> 00:30 next day), supply date from a DATE value', /2026-10-18 00:30:05/.test(std) && /2026-10-17/.test(std));
  chk('invoice: QR printed on every kind; simplified marks it mandatory and prints it larger', std.includes('id="qrcode"') && sim.includes('id="qrcode"') && /QR إلزامي/.test(sim) && /width:38mm/.test(sim) && /width:30mm/.test(std));
  chk('invoice: simplified without buyer prints «عميل نقدي»; tax invoice without VAT no. says غير مسجل', /عميل نقدي/.test(sim) && /غير مسجل/.test(renderInvoiceHtml({ i: { ...base, kind: 'standard' }, co, lines, buyer: { name_ar: 'أ' }, qrSvg: qr })));
  chk('invoice: credit note shows title, original invoice number and reason', /إشعار دائن/.test(cr) && /Credit Note/.test(cr) && /INV-1/.test(cr) && /إرجاع بضاعة/.test(cr) && !/الفاتورة الأصلية/.test(std));
  chk('invoice: no HTML injection from names/descriptions; A4 + no external URLs', !/<b>x<\/b>|<img src=x/.test(std) && /size:A4/.test(std) && !/https?:\/\//.test(std));
  chk('invoice: fmt adds thousands separators', fmt('1557') === '1,557.00'); }

// version stamp: package.json == api/src/version.js == WEB_VERSION (stale web folder detection relies on it)
{ const pj = JSON.parse(fs.readFileSync(path.join(root, 'api/package.json'), 'utf8')).version, vj = /APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'api/src/version.js'), 'utf8'))?.[1], wj = /WEB_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'web/app.js'), 'utf8'))?.[1];
  chk('version: package.json, api/src/version.js and web/app.js WEB_VERSION are identical', !!pj && pj === vj && pj === wj, `${pj} / ${vj} / ${wj}`);
  const { renderInvoiceHtml: R } = await imp('invoice-print.js'); const h = R({ i: { number: 'X', kind: 'simplified', issue_at: '2026-10-17T10:00:00Z', supply_date: '2026-10-17', icv: 1, subtotal: '1.00', vat_amount: '0.15', total: '1.15', issued_by: 'cashier1' }, co: { name_ar: 'ش', vat_number: '300000000000003' }, lines: [], qrSvg: '' });
  chk('invoice print shows the issuing user (cashier)', /cashier1/.test(h) && /Issued by/.test(h)); }

// ---- SEC-04 / T-10: production configuration gate (every negative case must REFUSE; values are never echoed) ----
{
  const prod2 = o => ({ NODE_ENV: 'production', JWT_SECRET: 'k9Qv3xLw8ZpR2mTn7YbH5cJd1FgS4aUe6VoXiNz0', DATABASE_URL: 'postgres://erpx_app:Zp8wQ3rLm7TxV2nYk@db:5432/erpx', ...o });
  chk('config: strong production env accepted', !throws(() => assertProductionSecrets(prod2()), /./));
  chk('config: DB user erpx_owner refused (api must use the least-privilege role)', throws(() => assertProductionSecrets(prod2({ DATABASE_URL: 'postgres://erpx_owner:Zp8wQ3rLm7TxV2nYk@db:5432/erpx' })), /least-privilege/));
  chk('config: DB user postgres refused', throws(() => assertProductionSecrets(prod2({ DATABASE_URL: 'postgres://postgres:Zp8wQ3rLm7TxV2nYk@db:5432/erpx' })), /least-privilege/));
  chk('config: OWNER_DATABASE_URL inside the api process refused', throws(() => assertProductionSecrets(prod2({ OWNER_DATABASE_URL: 'postgres://erpx_owner:x@db/erpx' })), /OWNER_DATABASE_URL/));
  chk('config: PUBLIC_RATE_LIMIT_MAX (test-only switch) refused in production', throws(() => assertProductionSecrets(prod2({ PUBLIC_RATE_LIMIT_MAX: '100000' })), /PUBLIC_RATE_LIMIT_MAX/));
  chk('config: default admin password refused when present', throws(() => assertProductionSecrets(prod2({ ADMIN_PASSWORD: 'ChangeMe!2026' })), /ADMIN_PASSWORD/));
  chk('config: JWT secret equal to the DB password refused', throws(() => assertProductionSecrets(prod2({ JWT_SECRET: 'Zp8wQ3rLm7TxV2nYkZp8wQ3rLm7TxV2nYk', DATABASE_URL: 'postgres://erpx_app:Zp8wQ3rLm7TxV2nYkZp8wQ3rLm7TxV2nYk@db/erpx' })), /different/));
  chk('config: repeated-character secret refused (aaaaaaaa...)', throws(() => assertProductionSecrets(prod2({ JWT_SECRET: 'a'.repeat(40) })), /variety/));
  chk('config: 12345 / password / qwerty style values refused', throws(() => assertProductionSecrets(prod2({ DATABASE_URL: 'postgres://erpx_app:Password123456@db/erpx' })), /weak/));
  let msg = ''; try { assertProductionSecrets(prod2({ JWT_SECRET: 'dev-only-change-me' })); } catch (e) { msg = e.message; }
  chk('config: the error message never contains the secret value', !msg.includes('dev-only-change-me'), msg);
  const good = { NODE_ENV: 'production', JWT_SECRET: 'k9Qv3xLw8ZpR2mTn7YbH5cJd1FgS4aUe6VoXiNz0', OWNER_DB_PASSWORD: 'Hn4Rt8Wq2Lz6Xc9Vb3Mp', APP_DB_PASSWORD: 'Zp8wQ3rLm7TxV2nYk5Dg', ADMIN_PASSWORD: 'Jr7Ks2Nd9Fh4Gv6Bx1Qw' };
  chk('deploy .env: strong distinct secrets accepted', validateDeployEnv(good).length === 0, validateDeployEnv(good).join(';'));
  chk('deploy .env: the shipped .env.example values are refused (all four defaults)', validateDeployEnv({ NODE_ENV: 'development', OWNER_DB_PASSWORD: 'change-me-owner', APP_DB_PASSWORD: 'change-me-app', ADMIN_PASSWORD: 'change-me-admin', JWT_SECRET: 'change-me-long-random-string' }).length >= 5);
  chk('deploy .env: missing secret refused', validateDeployEnv({ ...good, ADMIN_PASSWORD: '' }).some(p => /ADMIN_PASSWORD/.test(p)));
  chk('deploy .env: reused secret refused', validateDeployEnv({ ...good, APP_DB_PASSWORD: good.OWNER_DB_PASSWORD }).some(p => /DIFFERENT/.test(p)));
  chk('deploy .env: NODE_ENV must be production', validateDeployEnv({ ...good, NODE_ENV: 'development' }).some(p => /NODE_ENV/.test(p)));
}

console.log(failed ? `\n${failed} FAILED` : '\nALL UNIT CHECKS PASSED'); process.exit(failed ? 1 : 0);
