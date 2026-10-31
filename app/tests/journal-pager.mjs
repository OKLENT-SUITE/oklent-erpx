// 1.3.4: journal-entry modal + Odoo-style pager, fully offline (mocked API, jsdom). Run: cd api && node ../tests/journal-pager.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { JSDOM } = createRequire(path.join(root, 'api', 'package.json'))('jsdom');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://x/', pretendToBeVisual: true });
const w = dom.window;
for (const k of ['document', 'localStorage', 'navigator', 'Blob', 'FormData', 'HTMLElement', 'Node']) { try { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); } catch {} }
globalThis.window = w; globalThis.location = w.location; globalThis.confirm = () => true; globalThis.prompt = () => null;
w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
const TOTAL = 95, mk = i => ({ id: i, entry_no: 'JE-' + String(i).padStart(5, '0'), entry_date: '2026-10-01', memo: 'm' + i, source_type: 'manual', total_base: 100 });
const calls = [];
globalThis.fetch = async (u) => {
  u = String(u); calls.push(u); const hd = new Map(); let body = [];
  if (u.startsWith('/nav.json')) body = JSON.parse(fs.readFileSync(path.join(root, 'web/nav.json'), 'utf8'));
  else if (u.startsWith('/api/journal?')) { const q = new URL(u, 'http://x'), lim = +q.searchParams.get('limit'), off = +q.searchParams.get('offset') || 0; body = Array.from({ length: Math.min(lim, TOTAL - off) }, (_, i) => mk(TOTAL - off - i)); hd.set('x-total-count', String(TOTAL)); }
  else if (u.startsWith('/api/invoices?')) { body = Array.from({length:65},(_,i)=>({id:65-i,number:'INV-'+String(65-i).padStart(6,'0'),kind:'simplified',issue_at:'2026-10-01T00:00:00Z',issue_date:'2026-10-01',subtotal:10,vat_amount:1.5,total:11.5,outstanding:11.5,icv:65-i})); hd.set('x-total-count','65'); }
  else if (/^\/api\/invoices\/\d+\/print$/.test(u)) body = '<!doctype html><title>Invoice</title>';
  else if (/^\/api\/journal\/\d+$/.test(u)) body = { ...mk(7), row_hash: null, prev_hash: null, reversed_by: null, lines: [{ code: '1110', name_ar: 'الصندوق', debit: 100, credit: 0, rate: 1, currency_code: 'SAR' }, { code: '4100', name_ar: 'إيراد', debit: 0, credit: 100, rate: 1, currency_code: 'SAR' }] };
  else if (u.startsWith('/api/company')) body = { name_ar: 'x', vat_number: '1' };
  else if (u.startsWith('/api/menu-settings')) body = { disabled: [], locked: [] };
  else if (u.startsWith('/api/health')) body = { version: '1.4.0' };
  return { ok: true, status: 200, statusText: 'OK', headers: { get: k => hd.get(k) ?? null }, json: async () => body, text: async () => typeof body==='string'?body:JSON.stringify(body), blob: async()=>new Blob([]) };
};
w.localStorage.setItem('erpx_token', 't'); w.localStorage.setItem('erpx_user', JSON.stringify({ username: 'a', role: 'admin' }));
await import(pathToFileURL(path.join(root, 'web/app.js')).href); await sleep(400);
const doc = w.document; let bad = 0; const chk = (n, ok, d = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' :: ' + d)); if (!ok) bad++; };
doc.querySelector('aside a[data-v="journal"]').click(); await sleep(400);
const cnt = () => doc.querySelector('#main .tcount b.n')?.textContent.trim();
chk('journal: counter shows 1-30 / 95', cnt() === '1-30 / 95', cnt());
chk('journal: first request is limit=30&offset=0', calls.some(c => c.includes('/api/journal?limit=30&offset=0')));
chk('journal: 30 rows rendered', doc.querySelectorAll('#main tbody tr').length === 30);
doc.querySelector('#main [data-pg="next"]').click(); await sleep(400);
chk('journal: next arrow -> 31-60 / 95 (server offset 30)', cnt() === '31-60 / 95' && calls.some(c => c.includes('offset=30')), cnt());
doc.querySelector('#main [data-pg="next"]').click(); await sleep(400); doc.querySelector('#main [data-pg="next"]').click(); await sleep(400);
chk('journal: last page 91-95 / 95 and next disabled', cnt() === '91-95 / 95' && doc.querySelector('#main [data-pg="next"]').disabled, cnt());
doc.querySelector('#main a[data-je]').click(); await sleep(300);
const dlg = doc.querySelector('dialog.jmodal');
chk('journal: clicking the entry number opens the detail modal with its lines (null hash tolerated)', !!dlg && dlg.hasAttribute('open') && dlg.querySelectorAll('tbody tr').length === 2 && /JE-00007/.test(dlg.textContent), dlg?.textContent.slice(0, 80));
dlg.querySelector('[data-x]').click(); await sleep(50);
chk('journal: modal closes and is removed', !doc.querySelector('dialog.jmodal'));
doc.querySelector('aside a[data-v="invoices"]').click(); await sleep(400);
const invCnt=()=>doc.querySelector('#main #inv-tbl .tcount b.n')?.textContent.trim();
chk('invoices: first page shows 1-30 / 65',invCnt()==='1-30 / 65',invCnt());
chk('invoices: pager container no longer shares the print-action data attribute',!doc.querySelector('#inv-tbl .pgw[data-p]'));
chk('invoice form: estimate and rental helper copy removed',!doc.querySelector('#main').textContent.includes('تقديري — الحساب النهائي')&&!doc.querySelector('#main').textContent.includes('بند الإيجار (منتج تأجير'));
doc.querySelector('#inv-tbl [data-pg="next"]').click(); await sleep(50);
chk('invoices: next arrow shows 31-60 / 65 without opening /invoices/0/print',invCnt()==='31-60 / 65'&&!calls.some(c=>c==='/api/invoices/0/print'),invCnt());
const visiblePrint=[...doc.querySelectorAll('#inv-tbl tbody tr:not([hidden]) button[data-p]')][0];
visiblePrint?.click(); await sleep(100);
chk('invoices: print action requests the selected invoice id',calls.includes(`/api/invoices/${visiblePrint?.dataset.p}/print`)&&visiblePrint?.dataset.p!=='0');
console.log(bad ? `\n${bad} FAILED` : '\nALL JOURNAL/PAGER CHECKS PASSED'); process.exit(bad ? 1 : 0);
