// UI smoke test: loads the real web client in jsdom, logs in against a RUNNING api, clicks every sidebar item
// and fails if any screen shows an error toast, throws, or renders empty.
//   npm i --no-save jsdom   (dev tool only, not part of the production image)
//   BASE=http://localhost:3100 ADMIN_PASSWORD=... node tests/ui-smoke.mjs
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:3100';
const PASS = process.env.ADMIN_PASSWORD || 'ChangeMe!2026';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: BASE + '/', pretendToBeVisual: true });
const w = dom.window;
for (const k of ['document', 'localStorage', 'navigator', 'Blob', 'FormData', 'HTMLElement', 'Node']) {
  try { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); } catch {}
}
globalThis.window = w; globalThis.location = w.location;
globalThis.prompt = () => null; globalThis.confirm = () => false; globalThis.open = () => null; globalThis.print = () => {};
globalThis.URL.createObjectURL = () => 'blob:x';
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(String(u).startsWith('/') ? BASE + u : u, o);
const errors = [];
w.addEventListener('error', e => errors.push('window.error: ' + e.message));
process.on('unhandledRejection', e => errors.push('unhandledRejection: ' + (e?.message || e)));

// log in through the real endpoint, then boot the real app.js
const r = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PASS }) });
const j = await r.json(); if (!j.token) { console.error('login failed', j); process.exit(2); }
w.localStorage.setItem('erpx_token', j.token); w.localStorage.setItem('erpx_user', JSON.stringify(j.user));
await import(pathToFileURL(path.join(root, 'web/app.js')).href);
await sleep(1500);

const doc = w.document;
const items = [...doc.querySelectorAll('aside a[data-v]')].map(a => ({ v: a.dataset.v, label: a.textContent.trim() }));
const groups = [...doc.querySelectorAll('.nav-h')].length;
console.log(`sidebar: ${groups} main menus, ${items.length} sub-menus visible\n`);
let failed = 0;
for (const it of items) {
  doc.querySelectorAll('.toast').forEach(t => t.remove()); errors.length = 0;
  const a = doc.querySelector(`aside a[data-v="${it.v}"]`); if (!a) { console.log('MISSING', it.v); failed++; continue; }
  a.click(); await sleep(900);
  const main = doc.querySelector('#main'); const toast = doc.querySelector('.toast.err');
  const empty = !main || main.textContent.trim().length < 20 || /جارٍ التحميل/.test(main.textContent) && main.textContent.trim().length < 40;
  const planned = main?.querySelector('.planned');
  const bad = toast || errors.length || empty || planned;
  if (bad) failed++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${it.v.padEnd(12)} ${it.label}${toast ? '  → ' + toast.textContent.slice(0, 120) : ''}${errors.length ? '  → ' + errors[0].slice(0, 120) : ''}${empty ? '  → empty screen' : ''}${planned ? '  → still "planned/not active"' : ''}`);
}

// ---- write flows (the exact bug reported: saving site settings with decimal numbers) ----
const flow = async (name, fn) => { doc.querySelectorAll('.toast').forEach(t => t.remove()); errors.length = 0; try { await fn(); } catch (e) { errors.push(e.message); } await sleep(1200);
  const err = doc.querySelector('.toast.err'), ok = doc.querySelector('.toast.ok'); const bad = err || errors.length || !ok; if (bad) failed++;
  console.log(`${bad ? 'FAIL' : 'ok  '} flow: ${name}${err ? '  → ' + err.textContent.slice(0, 140) : ''}${errors.length ? '  → ' + errors[0] : ''}${!ok && !err ? '  → no success toast' : ''}`); };
const open_ = async v => { doc.querySelector(`aside a[data-v="${v}"]`).click(); await sleep(900); };
await open_('stores');
await flow('save site settings (delivery 30.00 / free over 500.00 / min 0.00)', async () => {
  doc.querySelector('#wd').value = '30.00'; doc.querySelector('#wf').value = '500.00'; doc.querySelector('#wm').value = '0.00'; doc.querySelector('#ws').click(); });
await flow('apply default site settings (fill blanks)', async () => { await sleep(300); doc.querySelector('#sd').click(); });
await open_('products');
await flow('add product with decimal price', async () => {
  doc.querySelector('#ps').value = 'UI-' + Date.now(); doc.querySelector('#pn').value = 'منتج اختبار واجهة'; doc.querySelector('#pp').value = '19.90'; doc.querySelector('#pa').click(); });

// ---- navigation structure (approved order), accordion behaviour, type scale, visibility settings ----
import fs from 'node:fs';
const nav = JSON.parse(fs.readFileSync(path.join(root, 'web/nav.json'), 'utf8')).mains;
const css = fs.readFileSync(path.join(root, 'web/style.css'), 'utf8');
const chk = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  → ' + extra}`); };
const heads = () => [...doc.querySelectorAll('.nav-h span:nth-child(2)')].map(x => x.textContent);
const expectedHeads = ['لوحة التحكم', 'العمليات', 'الموارد البشرية', 'المالية', 'المتجر', 'التقارير', 'الإعدادات'];
chk('main menus in approved 7 sections order', JSON.stringify(heads()) === JSON.stringify(expectedHeads), JSON.stringify(heads()));
const hrMain = nav.find(m => m.id === 'hr');
chk('الموارد البشرية contains شؤون الموظفين (الموظفون / الرواتب / العهد)', JSON.stringify(hrMain.secs[0].kids.map(k => k[1])) === JSON.stringify(['الموظفون', 'الرواتب', 'العهد']));
chk('المالية contains المصروفات والقيود ودليل الحسابات', nav.find(m => m.id === 'fin').secs[0].kids.some(k => k[0] === 'expenses'));
chk('التقارير holds التقارير المالية + تقارير المبيعات + تقارير المشتريات + تقارير الموارد البشرية', JSON.stringify(nav.find(m => m.id === 'reps').secs[0].kids.map(k => k[1])) === JSON.stringify(['التقارير المالية', 'تقارير المبيعات', 'تقارير المشتريات', 'تقارير الموارد البشرية']));
chk('لوحة التحكم: «لوحة التحكم» و«مختبر القواعد»', JSON.stringify(nav.find(m => m.id === 'dash').secs[0].kids.map(k => k[1])) === JSON.stringify(['لوحة التحكم', 'مختبر القواعد']));
chk('docs live under الإعدادات', nav.find(m => m.id === 'admin').secs.some(x => x.t === 'التوثيق'));
const px = re => +(new RegExp(re + '[^}]*?font-size:(\\d+(?:\\.\\d+)?)px').exec(css)?.[1] || 0);
chk('font scale: main 16 > section 14 > item 13', px('\\.nav-h\\{') === 16 && px('\\.nav-sh\\{') === 14 && px('\\.nav-k a\\{') === 13, [px('\\.nav-h\\{'), px('\\.nav-sh\\{'), px('\\.nav-k a\\{')].join('/'));
// accordion: open العمليات -> sections are collapsed; click one -> only that one opens
{ const h = doc.querySelector('.nav-h[data-g="ops"]'); if (h && !h.parentElement.classList.contains('open')) h.click(); await sleep(200); }
const opsEl = doc.querySelector('.nav-h[data-g="ops"]')?.parentElement;
if (opsEl) {
  opsEl.querySelectorAll('.nav-sec.open > .nav-sh').forEach(h => h.click()); await sleep(100);
  chk('العمليات shows 3 sections (المبيعات / المشتريات / المخزون)', opsEl.querySelectorAll('.nav-sh').length === 3);
  opsEl.querySelector('.nav-sh[data-s="purch"]')?.click(); await sleep(150);
  chk('click section -> items open', opsEl.querySelector('.nav-sec.open')?.querySelector('.nav-sh')?.dataset.s === 'purch');
}
// visibility settings: hide POS, check it disappears, restore
await open_('menus');
const pos = doc.querySelector('input[data-id="pos"]'); chk('settings screen lists the switches', !!pos && !!doc.querySelector('input[data-id="main:ops"]') && doc.querySelector('input[data-id="users"]')?.disabled !== false || !doc.querySelector('input[data-id="users"]'));
pos.checked = false; pos.dispatchEvent(new w.Event('change')); await sleep(200);
await flow('save menu visibility (hide نقاط البيع)', async () => { doc.querySelector('#sv').click(); });
chk('hidden item is gone from the sidebar', !doc.querySelector('aside a[data-v="pos"]'));
await open_('menus'); const pos2 = doc.querySelector('input[data-id="pos"]'); pos2.checked = true; pos2.dispatchEvent(new w.Event('change')); await sleep(200);
await flow('restore menu visibility', async () => { doc.querySelector('#sv').click(); });
chk('item is back after re-enabling', !!doc.querySelector('aside a[data-v="pos"]'));
// protected screens have no switch; hidden screen -> the current screen falls back to a visible one (UI only: API permissions untouched)
await open_('menus');
chk('protected screens (الإدارة وحسابي، إعدادات القوائم) cannot be switched off', doc.querySelector('input[data-id="users"]')?.disabled === true || !doc.querySelector('input[data-id="users"]'));
chk('settings note says hiding is NOT a substitute for permissions', /وليس بديلاً عن الصلاحيات/.test(doc.querySelector('#main')?.textContent || ''));
await open_('journal');
const setHidden = async list => (await realFetch(BASE + '/api/menu-settings', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + j.token }, body: JSON.stringify({ disabled: list }) })).status;
chk('another admin hides the screen I am on (قيود اليومية)', await setHidden(['properties', 'owners', 'journal']) === 200);
w.dispatchEvent(new w.Event('focus')); await sleep(1500);
chk('→ my screen falls back to a visible one, sidebar intact, nothing stuck on loading', !doc.querySelector('aside a[data-v="journal"]') && !!doc.querySelector('aside a.on') && (doc.querySelector('#main')?.textContent || '').trim().length > 20 && !/جارٍ التحميل/.test(doc.querySelector('#main')?.textContent || '') && doc.querySelectorAll('.nav-h').length === 7, doc.querySelector('aside a.on')?.textContent);
chk('restore: screen is back', await setHidden(['properties', 'owners']) === 200); w.dispatchEvent(new w.Event('focus')); await sleep(1200);
chk('→ قيود اليومية visible again', !!doc.querySelector('aside a[data-v="journal"]'));
await open_('geo'); { const nums = [...(doc.querySelectorAll('.kpi b') || [])].map(x => Number(x.textContent)); chk('geo screen: 13 regions, >= 134 cities, >= 1329 districts', nums[0] === 13 && nums[1] >= 134 && nums[2] >= 1329, JSON.stringify(nums)); }

// ---- a failing request must show a readable error in the page (never an endless "loading") ----
{ const f0 = globalThis.fetch;
  globalThis.fetch = (u, o) => String(u).includes('/api/branches') ? Promise.resolve(new Response(JSON.stringify({ error: 'boom-test' }), { status: 500, headers: { 'content-type': 'application/json' } })) : f0(u, o);
  await open_('stores'); await sleep(500); const mt = doc.querySelector('#main')?.textContent || '';
  chk('API failure is shown inside the screen with the failing URL', /تعذّر تحميل/.test(mt) && /boom-test/.test(mt) && /\/api\/branches/.test(mt), mt.slice(0, 120));
  globalThis.fetch = f0; await open_('stores'); chk('screen recovers after the failure', !/تعذّر تحميل/.test(doc.querySelector('#main')?.textContent || '') && /إعدادات المتجر/.test(doc.querySelector('#main')?.textContent || '')); }

// ---- v0.5.0: icons beside every menu, products stock controls, stock/bookings screens ----
{ const items = [...doc.querySelectorAll('aside a[data-v]')]; const heads = [...doc.querySelectorAll('.nav-h')]; const secs = [...doc.querySelectorAll('.nav-sh')];
  chk('every menu item has an icon', items.length > 0 && items.every(a => a.querySelector('svg.ico')), items.filter(a => !a.querySelector('svg.ico')).map(a => a.dataset.v).join(','));
  chk('every main menu and section has an icon', heads.every(h => h.querySelector('svg.ico')) && secs.every(h => h.querySelector('svg.ico')));
  chk('menu icons are defined for every nav.json entry', (() => { const ic = JSON.parse(fs.readFileSync(path.join(root, 'web/nav.json'), 'utf8')).icons; const ids = nav.flatMap(m => ['main:' + m.id, ...m.secs.flatMap(sc => [...(sc.t ? ['sec:' + sc.id] : []), ...sc.kids.map(k => k[0])])]); return ids.every(id => ic[id]); })()); }
await open_('products'); chk('products form: stock tracking + opening quantity', !!doc.getElementById('pst') && !!doc.getElementById('pq') && /المخزون/.test(doc.querySelector('#tb')?.textContent || ''));
await open_('stock'); chk('stock screen shows tracked items, KPIs and the receipt form', /أصناف متتبَّعة/.test(doc.querySelector('#main').textContent) && !!doc.getElementById('rs') && doc.querySelectorAll('#main tbody tr').length > 3);
await open_('count'); { const inp = doc.querySelector('[data-c]'); chk('count screen has input per item and shows the difference live', !!inp); inp.value = String(Number(inp.dataset.h) + 2); inp.dispatchEvent(new w.Event('input')); chk('count screen: difference +2 shown', doc.getElementById('df' + inp.dataset.c).textContent === '+2'); }
await open_('bookings'); { chk('bookings: status filters with counts + search', doc.querySelectorAll('#bf [data-f]').length === 6 && !!doc.getElementById('bq'));
  const row = [...doc.querySelectorAll('#tb tbody tr')].find(r => r.textContent.includes('جديد')); if (row) { row.querySelector('[data-k]').click(); await sleep(900); chk('booking detail lists technicians (same city first / busy disabled)', doc.querySelectorAll('#at option').length > 0, doc.querySelector('#dt')?.textContent?.slice(0, 80)); }
  doc.querySelector('.tabs [data-t="techs"]').click(); await sleep(300); chk('technicians tab: add form with region and city', !!doc.getElementById('tr') && !!doc.getElementById('tc') && doc.querySelectorAll('#tc option').length > 3); }

console.log(`\n${failed ? failed + ' check(s) FAILED' : 'ALL CHECKS PASSED'} (${items.length} screens + write flows)`);
process.exit(failed ? 1 : 0);
