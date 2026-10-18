// Products screen image UI WITHOUT a database/server: web/commerce.js is loaded with a fake API.
// Run: cd api && npm i --no-save jsdom && node ../tests/products-image-smoke.mjs
import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { JSDOM } = createRequire(path.join(root, 'api', 'package.json'))('jsdom');
let bad = 0; const chk = (n, ok, d = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + d)); if (!ok) bad++; };
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const dom = new JSDOM('<!doctype html><body><main id="main"></main></body>', { url: 'http://localhost:3100/', pretendToBeVisual: true }); const w = dom.window;
for (const k of ['document', 'CustomEvent', 'File', 'Event']) globalThis[k] = w[k];
globalThis.URL = Object.assign(URL, { createObjectURL: f => 'blob:test/' + f.name, revokeObjectURL: () => {} }); globalThis.confirm = () => true; globalThis.open = () => ({});
w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const calls = []; const fetches = []; let products = [{ id: 1, sku: 'A1', name_ar: 'منتج بصورة', kind: 'goods', is_active: true, category: 'ألعاب', sale_price: '10.00', unit_discount: '0', revenue_account: '4200', stock_tracked: false, published: true, image_url: '/uploads/products/3f2b8a52-1c0e-4a77-9d1e-0a1b2c3d4e5f.png' }, { id: 2, sku: 'A2', name_ar: 'منتج بلا صورة', is_active: true, kind: 'goods', category: 'ألعاب', sale_price: '5.00', unit_discount: '0', revenue_account: '4200', stock_tracked: false, published: false, image_url: null }];
const toasts = [];
const X = { esc, money: v => Number(v).toFixed(2), today: () => '2026-10-17', head: t => `<h2>${t}</h2><div class="tabs"></div>`, foot: () => '', done: () => {}, csv: () => {}, num: k => ({ k, num: true, f: r => r[k] }), tag: (c, t) => `<span>${esc(t)}</span>`,
  table: (cols, rows) => `<table><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  $: s => document.querySelector(s), toast: (...a) => toasts.push(a.join('|')), guard: fn => async (...a) => { try { await fn(...a); } catch (e) { toasts.push('ERR:' + e.message); } },
  getMe: () => ({ role: 'admin' }), token: () => 'T0K', reloadStores: async () => {}, rerender: () => {},
  api: async (p, o = {}) => { calls.push([o.method || 'GET', p, o.body]); if (p === '/products' && !o.method) return products; if (p === '/offers') return []; if (p === '/stores') return [{ id: 1, name_ar: 'المتجر', is_active: true, features: ['pos'] }]; if (p === '/tax-codes') return [{ code: 'S15', name_ar: '15%' }];
    if (p === '/products' && o.method === 'POST') { products = [{ id: 3, sku: o.body.sku, name_ar: o.body.name_ar, kind: 'goods', sale_price: '1', unit_discount: '0', revenue_account: '4200', published: false, image_url: o.body.image_url || null }, ...products]; return products[0]; }
    return {}; } };
globalThis.fetch = async (u, o) => { fetches.push([u, o]); const fail = globalThis.__failUpload; return fail ? { ok: false, status: 415, json: async () => ({ error: 'نوع الملف غير مدعوم' }) } : { ok: true, status: 200, json: async () => ({ id: 3, image_url: '/uploads/products/new.png' }) }; };
const { installCommerce } = await import(pathToFileURL(path.join(root, 'web/commerce.js')).href); const VIEWS = {}; installCommerce(VIEWS, X);
const main = document.getElementById('main'); await VIEWS.products(main); await tick();
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const setFile = (input, f) => { Object.defineProperty(input, 'files', { value: f ? [f] : [], configurable: true }); input.dispatchEvent(new w.Event('change')); };
const png = (n, size = 100) => new File([new Uint8Array(size)], n, { type: 'image/png' });

chk('table: image column renders the stored path as <img>; placeholder when none', $$('img.pthumb').length === 1 && $('img.pthumb').getAttribute('src').startsWith('/uploads/products/') && $$('span.pthumb.ph').length === 1);
chk('add form has: file chooser (jpeg/png/webp only), preview box, URL fallback', $('#pif').accept === 'image/jpeg,image/png,image/webp' && !!$('#pip') && !!$('#pi'));
setFile($('#pif'), new File(['x'], 'a.gif', { type: 'image/gif' })); await tick();
chk('validation: GIF refused with a message, no preview', /نوع الملف غير مدعوم/.test($('#pim').textContent) && !$('#pip img'));
setFile($('#pif'), png('big.png', 2 * 1024 * 1024 + 1)); await tick();
chk('validation: > 2 MB refused with a message', /يتجاوز الحد/.test($('#pim').textContent) && !$('#pip img'));
setFile($('#pif'), png('ok.png')); await tick();
chk('valid image: preview shown BEFORE saving, nothing uploaded yet', $('#pip img')?.getAttribute('src') === 'blob:test/ok.png' && !$('#pix').hidden && fetches.length === 0);
$('#ps').value = 'N1'; $('#pn').value = 'جديد'; $('#pp').value = '9.99'; $('#pa').click(); await tick(60);
const post = calls.find(c => c[0] === 'POST' && c[1] === '/products');
chk('save: product created first (no image_url in body when a file is chosen)', !!post && post[2].image_url === undefined && post[2].sku === 'N1');
chk('save: image uploaded to /api/products/3/image as raw bytes with the file type + bearer token', fetches[0]?.[0] === '/api/products/3/image' && fetches[0][1].method === 'POST' && fetches[0][1].headers['content-type'] === 'image/png' && fetches[0][1].headers.authorization === 'Bearer T0K' && fetches[0][1].body instanceof File);
chk('success toast', toasts.some(t => /تمت الإضافة/.test(t)));
// failure after product creation
globalThis.__failUpload = true; toasts.length = 0; fetches.length = 0; await tick(40);
setFile($('#pif'), png('x2.png')); await tick(); $('#ps').value = 'N2'; $('#pn').value = 'ثانٍ'; $('#pp').value = '1'; $('#pa').click(); await tick(60);
chk('upload failure: product kept, user told how to retry', toasts.some(t => /تعذّر رفع الصورة/.test(t) && /زر «الصورة»/.test(t)));
globalThis.__failUpload = false;
// row dialog
await VIEWS.products(main); await tick(); const btns = $$('[data-img]'); chk('each row has an «الصورة» button', btns.length === products.length);
btns[btns.length - 1].click(); await tick(); const dlg = $('dialog.imgdlg');
chk('dialog opens (last row = product WITHOUT image): save disabled until a valid file is chosen; no delete button', !!dlg && dlg.hasAttribute('open') && dlg.querySelector('#ds').disabled && !dlg.querySelector('#dr'));
setFile(dlg.querySelector('#df'), new File(['x'], 'doc.pdf', { type: 'application/pdf' })); await tick();
chk('dialog: PDF refused', /غير مدعوم/.test(dlg.querySelector('#dm').textContent) && dlg.querySelector('#ds').disabled);
setFile(dlg.querySelector('#df'), png('p2.png')); await tick();
chk('dialog: preview + save enabled', dlg.querySelector('#dp img')?.getAttribute('src') === 'blob:test/p2.png' && !dlg.querySelector('#ds').disabled);
fetches.length = 0; calls.length = 0; dlg.querySelector('#ds').click(); await tick(60);
chk('dialog: save uploads for that product id and closes', fetches[0]?.[0].startsWith('/api/products/') && !$('dialog.imgdlg'));
// delete
const withImg = $$('[data-img]')[$$('[data-img]').length - 1]; await VIEWS.products(main); await tick();
const first = $$('[data-img]').find(b => products.find(p => p.id === +b.dataset.img)?.image_url); first.click(); await tick(); $('dialog.imgdlg #dr').click(); await tick(40);
chk('product WITH image: dialog offers delete -> DELETE /products/:id/image', calls.some(c => c[0] === 'DELETE' && /^\/products\/\d+\/image$/.test(c[1])));
// POS tiles show the product image (or a placeholder) and the cart line shows a thumbnail
{ await VIEWS.pos(main); await tick(); const tiles = $$('#pg .pcard'); chk('POS: every tile has an image slot; products with an image show it', tiles.length >= 2 && tiles.every(x => x.querySelector('.pthumb.pimg')) && tiles.some(x => x.querySelector('img.pthumb')?.getAttribute('src')?.startsWith('/uploads/')), tiles.length);
  tiles[0].click(); await tick(); chk('POS: cart line carries the thumbnail', !!$('#ct .pthumb'));
  const im = $('#pg img.pthumb'); im.dispatchEvent(new w.Event('error')); await tick(); chk('POS: broken image -> placeholder keeps tile layout', !$('#pg img.pthumb[src="' + im.getAttribute('src') + '"]') && !!$('#pg .pthumb.pimg.ph')); }
console.log(bad ? `\n${bad} FAILED` : '\nALL PRODUCT-IMAGE UI CHECKS PASSED'); process.exit(bad ? 1 : 0);
