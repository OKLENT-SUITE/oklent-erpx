// OKLENT-ERPX web client: no build step, no framework. Talks only to /api. https://oklent.net/
import { installCommerce } from './commerce.js';
import { installDashboard } from './dashboard.js';
import { icon } from './icons.js';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => (s === null || s === undefined) ? '' : String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const money = v => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const plainNumber = (v, maximumFractionDigits = 2) => Number(v).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits });
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);   // Saudi business date (UTC+3), not the UTC date
const fiscalStart = () => { const d=today(), m=String(Number(co?.fiscal_start_month)||1).padStart(2,'0'), candidate=`${d.slice(0,4)}-${m}-01`; return candidate>d?`${Number(d.slice(0,4))-1}-${m}-01`:candidate; };
const WEB_VERSION = '1.4.9';   // must equal the API version (/api/health); a mismatch means the browser/web folder is stale
let token = localStorage.getItem('erpx_token'), me = JSON.parse(localStorage.getItem('erpx_user') || 'null'), co = null, view = 'dashboard', data = {};

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: opts.body ? JSON.stringify(opts.body) : (opts.method && opts.method !== 'GET' ? '{}' : undefined) });
  if (r.status === 401 && path !== '/auth/login') { logout(); throw new Error('انتهت الجلسة'); }
  const j = await r.json().catch(() => ({}));
  const tc = r.headers.get('x-total-count'); if (tc !== null && Array.isArray(j)) Object.defineProperty(j, 'total', { value: Number(tc) });   // server-side list size when the list is capped (document counter "shown-total")
  if (!r.ok) { const e = new Error((j.error || r.statusText) + ' [' + r.status + ' ' + (opts.method || 'GET') + ' /api' + path + ']'); e.rule = j.rule; throw e; }
  return j;
}
function toast(msg, ok = true, sub = '') { const t = document.createElement('div'); t.className = 'toast ' + (ok ? 'ok' : 'err'); t.innerHTML = esc(msg) + (sub ? `<small>${esc(sub)}</small>` : ''); document.body.append(t); setTimeout(() => t.remove(), ok ? 3000 : 7000); }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.rule ? 'رفضت قاعدة البيانات العملية' : 'خطأ', false, e.message); } };
const csv = (name, rows) => { const keys = Object.keys(rows[0] || {}); const body = [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + body + `\n"© 2026 OKLENT BUSINESS. جميع الحقوق محفوظة"\n`], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.csv'; a.click(); };

function printDoc(title, bodyHtml, opts = {}) {
  bodyHtml = String(bodyHtml).replace(/(<tr [^>]*?) hidden(?=[ >])/g, '$1').replace(/<span class="pgr[^"]*">[\s\S]*?<\/span>/g, '').replace(/<bdi dir="ltr" data-all="(\d+)">[^<]*<\/bdi>/g, '<bdi dir="ltr">$1</bdi>');   // 1.3.4: printouts always carry every row
  const w = window.open('', '_blank');
  if (!w) { toast('تعذّر فتح نافذة الطباعة — تأكد من السماح بالنوافذ المنبثقة', false); return; }
  const dateStr = opts.date || today();
  const subTitle = opts.subtitle ? `<div class="p-sub">${esc(opts.subtitle)}</div>` : '';
  const refNo = opts.ref ? `<div class="p-ref">رقم المرجع: <b>${esc(opts.ref)}</b></div>` : '';
  const metaHtml = opts.meta ? `<div class="p-meta">${opts.meta}</div>` : '';
  const signs = opts.signatures !== false ? `
    <div class="p-signs">
      <div class="p-sign-box"><span>إعداد / المحاسب المسؤول</span><b>${esc(opts.preparedBy || me?.username || 'المسؤول')}</b><div class="p-line">التوقيع: ______________</div></div>
      <div class="p-sign-box"><span>مراجعة / التدقيق المالي</span><b>${esc(opts.reviewedBy || 'المراجع المالي')}</b><div class="p-line">التوقيع: ______________</div></div>
      <div class="p-sign-box"><span>الاعتماد الإداري</span><b>${esc(opts.approvedBy || 'الإدارة العامة')}</b><div class="p-line">الختم والتوقيع: ______________</div></div>
    </div>` : '';
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <title>${esc(title)} — OKLENT BUSINESS</title>
    <style>
      @page { size: A4 portrait; margin: 12mm 14mm; }
      * { box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Tajawal", "Noto Sans Arabic", sans-serif; font-size: 13px; color: #1e293b; background: #fff; margin: 0; padding: 12px; }
      .p-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0d9488; padding-bottom: 12px; margin-bottom: 16px; }
      .p-brand { display: flex; align-items: center; gap: 12px; }
      .p-brand img { width: 44px; height: 44px; }
      .p-brand h1 { margin: 0; font-size: 20px; color: #0f172a; }
      .p-brand p { margin: 2px 0 0; font-size: 11px; color: #64748b; }
      .p-docinfo { text-align: left; }
      .p-docinfo h2 { margin: 0; font-size: 18px; color: #0d9488; }
      .p-docinfo .p-date { font-size: 11px; color: #64748b; margin-top: 4px; }
      .p-sub { margin-top: 4px; font-size: 12px; color: #475569; }
      .p-ref { font-size: 12px; margin-top: 4px; color: #0f172a; }
      .p-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin-bottom: 16px; font-size: 12px; }
      .p-meta-item { display: flex; flex-direction: column; gap: 2px; }
      .p-meta-label { color: #64748b; font-size: 11px; }
      .p-meta-val { font-weight: bold; color: #0f172a; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
      th { background: #f1f5f9; color: #334155; font-weight: bold; text-align: right; padding: 8px 10px; border: 1px solid #cbd5e1; }
      td { padding: 7px 10px; border: 1px solid #e2e8f0; vertical-align: middle; }
      th.num, td.num { text-align: left; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      tr.tot td { font-weight: bold; background: #f8fafc; border-top: 2px solid #cbd5e1; }
      .p-signs { display: flex; justify-content: space-between; gap: 16px; margin-top: 36px; page-break-inside: avoid; }
      .p-sign-box { flex: 1; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px; text-align: center; }
      .p-sign-box span { display: block; font-size: 11px; color: #64748b; margin-bottom: 4px; }
      .p-sign-box b { display: block; font-size: 13px; margin-bottom: 24px; }
      .p-line { font-size: 11px; color: #94a3b8; }
      .p-foot { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
      @media print { body { padding: 0; } .noprint { display: none !important; } button { display: none !important; } }
    </style></head><body>
      <div class="p-head">
        <div class="p-brand">
          <img src="/logo.png" alt="OKLENT">
          <div>
            <h1>${esc(co?.name_ar || 'شركة أكلنت للتجارة')}</h1>
            <p>الرقم الضريبي: <span dir="ltr">${esc(co?.vat_number || '310123456700003')}</span></p>
          </div>
        </div>
        <div class="p-docinfo">
          <h2>${esc(title)}</h2>
          ${subTitle}
          ${refNo}
          <div class="p-date">تاريخ الطباعة: <span dir="ltr">${dateStr}</span></div>
        </div>
      </div>
      ${metaHtml}
      <div class="p-body">${bodyHtml}</div>
      ${signs}
      <div class="p-foot">
        <span>نظام OKLENT BUSINESS v${WEB_VERSION} — محرك محاسبي وإداري سعودي معتمد</span>
        <span>طُبع بواسطة: ${esc(me?.username || 'مستخدم')} في ${dateStr}</span>
        <span>صفحة 1 من 1</span>
      </div>
    </body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (err) {} }, 500);
}

function logout() { localStorage.removeItem('erpx_token'); localStorage.removeItem('erpx_user'); token = null; me = null; render(); }
// Navigation = web/nav.json (main menu > section > item). Visibility = settings (إعدادات القوائم) AND store features.
let NAVI = {}; const ico = (id, size) => icon(NAVI[id], size);
let stores = [], NAV = [], menuOff = new Set(), menuLocked = new Set(), menuDefault = [];
const hasFeature = f => !f || stores.some(s => s.is_active && s.features.includes(f));
const kidsOf = sec => sec.kids.filter(k => !menuOff.has(k[0]) && hasFeature(k[2]));
const secOk = sec => !menuOff.has('sec:' + sec.id) && kidsOf(sec).length > 0;
const mainOk = g => !menuOff.has('main:' + g.id) && g.secs.some(secOk);
const visibleItems = () => NAV.filter(mainOk).flatMap(g => g.secs.filter(secOk).flatMap(sc => kidsOf(sc).map(k => k[0])));
const locate = v => { for (const g of NAV) for (const sc of g.secs) if (sc.kids.some(k => k[0] === v)) return { g, sc }; return {}; };
const loadSet = k => new Set(JSON.parse(localStorage.getItem(k) || '[]'));
let openGroups = loadSet('erpx_open_g'), openSecs = loadSet('erpx_open_s');
const saveOpen = () => { localStorage.setItem('erpx_open_g', JSON.stringify([...openGroups])); localStorage.setItem('erpx_open_s', JSON.stringify([...openSecs])); };

function render() {
  const app = $('#app');
  if (!token) return loginScreen(app);
  const vis = visibleItems();
  if (vis.length && !vis.includes(view)) view = vis.includes('dashboard') ? 'dashboard' : vis[0];
  const cur = locate(view); if (cur.g) { openGroups.add(cur.g.id); if (cur.sc.t) openSecs.add(cur.sc.id); }
  const kidsHtml = sc => kidsOf(sc).map(([id, l]) => `<a data-v="${id}" class="${view === id ? 'on' : ''}">${ico(id, 15)}<span>${l}</span></a>`).join('');
  app.innerHTML = `<div class="mobtop"><button class="btn ghost sm" id="mb">☰</button><img src="${esc(co?.logo_data_url||'/logo.png')}" alt="" width="26" height="26"><b>OKLENT BUSINESS</b></div><div class="shell"><aside id="side">
   <div class="brand"><img src="${esc(co?.logo_data_url||'/logo.png')}" alt="OKLENT" width="38" height="38">OKLENT BUSINESS</div>
   ${NAV.filter(mainOk).map(g => { const open = openGroups.has(g.id), on = cur.g?.id === g.id;
     return `<div class="nav-g ${open ? 'open' : ''} ${on ? 'cur' : ''}"><button class="nav-h" data-g="${g.id}"><span class="ic">${ico('main:' + g.id, 20) || g.ic}</span><span>${g.t}</span><i class="chev">‹</i></button><div class="nav-k">` +
       g.secs.filter(secOk).map(sc => sc.t
         ? `<div class="nav-sec ${openSecs.has(sc.id) ? 'open' : ''} ${cur.sc?.id === sc.id ? 'cur' : ''}"><button class="nav-sh" data-s="${sc.id}">${ico('sec:' + sc.id, 17)}<span>${sc.t}</span><i class="chev">‹</i></button><div class="nav-sk">${kidsHtml(sc)}</div></div>`
         : `<div class="nav-flat">${kidsHtml(sc)}</div>`).join('') + '</div></div>'; }).join('')}
   <a class="nav-out" id="lo">⏻ تسجيل الخروج</a></aside><main id="main"></main></div>`;
  $('#mb').onclick = () => $('#side').classList.toggle('open');
  $('#lo').onclick = logout;
  app.querySelectorAll('.nav-h').forEach(h => h.onclick = () => { const g = h.dataset.g; openGroups.has(g) ? openGroups.delete(g) : openGroups.add(g); saveOpen(); h.parentElement.classList.toggle('open'); });
  app.querySelectorAll('.nav-sh').forEach(h => h.onclick = () => { const x = h.dataset.s; openSecs.has(x) ? openSecs.delete(x) : openSecs.add(x); saveOpen(); h.parentElement.classList.toggle('open'); });
  app.querySelectorAll('aside a[data-v]').forEach(a => a.onclick = () => { view = a.dataset.v; $('#side').classList.remove('open'); render(); });
  const m = $('#main'); m.innerHTML = '<div class="sub">جارٍ التحميل…</div>';
  (async () => { try { await VIEWS[view.startsWith('doc:') ? 'doc' : view](m); }
    catch (e) { if (token) { m.innerHTML = `<div class="card"><h3>تعذّر تحميل هذه الشاشة</h3><p style="color:#b91c1c">${esc(e.message)}</p><pre>${esc(String(e.stack || '').split('\n').slice(0, 3).join('\n'))}</pre><button class="btn" id="retry">إعادة المحاولة</button> <span class="sub">إن تكرر الخطأ أرسل هذا النص مع آخر أسطر <code>docker compose logs api --tail 40</code></span></div>`; $('#retry').onclick = render; } } })();
}
function loginScreen(app) {
  app.innerHTML = `<div class="login"><form class="box" id="lf"><img class="logo" src="/logo.png" alt="OKLENT"><h1>OKLENT BUSINESS</h1><p>محرك محاسبي سعودي — قيد مزدوج · ZATCA المرحلة الأولى · إدارة أعمال</p>
   <label>اسم المستخدم<input name="u" autocomplete="username" required></label><br><label>كلمة المرور<input name="p" type="password" autocomplete="current-password" required></label><br>
   <button class="btn teal" style="width:100%">دخول</button><div class="foot" style="border:0"><span dir="ltr">© 2026 OKLENT BUSINESS.</span> جميع الحقوق محفوظة</div></form></div>`;
  $('#lf').onsubmit = guard(async e => { e.preventDefault(); const f = new FormData(e.target);
    const r = await api('/auth/login', { method: 'POST', body: { username: f.get('u'), password: f.get('p') } });
    token = r.token; me = r.user; localStorage.setItem('erpx_token', token); localStorage.setItem('erpx_user', JSON.stringify(me)); boot(); });
}
const head = (t, s = '', actions = '') => `<div class="top"><div><h2>${ico(view, 24)}${t}</h2><div class="sub">${s}</div></div><div class="noprint">${actions}</div></div>
  <div class="printhead"><b>${esc(co?.name_ar)}</b> — ${t} — الرقم الضريبي <span class="n">${esc(co?.vat_number)}</span> — طُبع في <span class="n">${today()}</span></div>`;
const foot = () => `<div class="foot"><span dir="ltr">© 2026 OKLENT BUSINESS.</span> جميع الحقوق محفوظة · <span class="n" title="إصدار الواجهة">v${WEB_VERSION}</span></div>`;

const LABELS = {
  subtotal: 'المبلغ قبل الضريبة', vat_amount: 'الضريبة', total: 'الإجمالي', outstanding: 'المتبقي',
  amount: 'المبلغ', debit: 'مدين', credit: 'دائن', net: 'الصافي', vat: 'الضريبة',
  basic_salary: 'الأساسي', housing_allowance: 'بدل سكن', transport_allowance: 'بدل نقل',
  other_allowances: 'بدلات أخرى', gross_salary: 'إجمالي الراتب', gosi_employee: 'تأمينات (GOSI)',
  advances_deduction: 'سلف', other_deductions: 'استقطاعات', total_deductions: 'إجمالي الاستقطاع',
  net_salary: 'صافي الراتب', balance: 'الرصيد المفتوح', total_net: 'الصافي'
};
// عدّاد السجلات: يظهر فوق كل جدول قوائم في التطبيق (يُعطَّل بـ opts.count=false وفي لوحة التحكم والتقارير والمستندات)
const NOUN = { invoices: 'الفواتير', partners: 'العملاء والأطراف', leases: 'العقود', bookings: 'الحجوزات', offers: 'العروض', transfers: 'الحوالات', orders: 'الطلبات', pos: 'العمليات', properties: 'العقارات', owners: 'الملاك', vendors: 'الموردين', bills: 'فواتير الموردين', apay: 'المستندات', products: 'الأصناف', stock: 'الأصناف', count: 'المستندات', employees: 'الموظفين', payroll: 'المسيرات', custody: 'العهد', expenses: 'المطالبات', quick: 'المصروفات', dues: 'المستندات', journal: 'القيود', accounts: 'الحسابات', periods: 'الفترات', currencies: 'العملات', stores: 'المتاجر', geo: 'السجلات', branches: 'الفروع', users: 'المستخدمين', salesrep: 'السجلات', purchrep: 'السجلات', hrrep: 'السجلات' };
const NOCOUNT = new Set(['dashboard', 'rules', 'reports', 'menus']);
// Document counter, ONE format app-wide: "shown-total" (e.g. 100-852). Lists that are complete show n-n; capped lists pass the server total.
const PAGE_SIZE = 30;   // documents per page, app-wide (Odoo-style pager "1-30 / 852" + arrows)
const pgState = {};     // server-paged screens keep their page index here (key = view)
const noCounter = o => o.count === false || NOCOUNT.has(view) || String(view).startsWith('doc');
const pgText = (p, ps, n) => n ? `${p * ps + 1}-${Math.min((p + 1) * ps, n)} / ${n}` : '0 / 0';
// Counter + arrows. Client mode (default): all rows are emitted, rows beyond the first page carry [hidden] and the delegated handler below flips pages.
// Server mode (opts.srv): only the current page was fetched; the arrows re-render the screen with pgState[view] changed.
const tcount = (n, o) => noCounter(o) ? '' : (() => {
  const srv = !!o.srv, ps = PAGE_SIZE, tot = srv ? Math.max(+o.total || 0, n) : n, p = srv ? (pgState[view] || 0) : 0, last = Math.max(Math.ceil(tot / ps) - 1, 0);
  const more = !srv && Number.isFinite(+o.total) && +o.total > n ? `<span class="chip" title="المحمّل من قاعدة البيانات ${n} من أصل ${+o.total}">من أصل <bdi dir="ltr">${+o.total}</bdi> في قاعدة البيانات</span>` : '';
  const arrows = tot > ps ? `<span class="pgr noprint"><button type="button" class="btn ghost sm" data-pg="prev" aria-label="الصفحة السابقة" ${p <= 0 ? 'disabled' : ''}>›</button><button type="button" class="btn ghost sm" data-pg="next" aria-label="الصفحة التالية" ${p >= last ? 'disabled' : ''}>‹</button></span>` : '';
  return `<div class="tcount"><span title="عدد ${NOUN[view] || 'السجلات'}">${NOUN[view] || 'السجلات'}: <b class="n"><bdi dir="ltr" data-all="${tot}">${pgText(p, ps, tot)}</bdi></b>${arrows}</span>${more}${o.extra ? `<span class="tchips">${o.extra}</span>` : ''}</div>`; })();
const table = (cols, rows, opts = {}) => {
  const n = rows ? rows.length : 0, paged = !noCounter(opts) && !opts.srv && n > PAGE_SIZE;
  return `<div class="pgw" data-page-index="0"${opts.srv ? ' data-srv="1"' : ''}>` + tcount(n, opts) + `<div class="scroll"><table><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.t ?? '')}</th>`).join('')}</tr></thead><tbody>${(rows && rows.length ? rows.map((r, i) =>
    `<tr class="${r._cls || ''}"${paged && i >= PAGE_SIZE ? ' hidden' : ''}>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.f ? (c.f(r) ?? '') : esc(r[c.k] ?? '')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="sub" style="text-align:center;padding:24px">لا توجد بيانات</td></tr>`)}</tbody></table></div></div>`;
};
// Pager arrows (delegated, installed once). Server-paged screens re-render; client-paged tables just show/hide rows.
document.addEventListener('click', e => {
  const b = e.target.closest?.('button[data-pg]'); if (!b || b.disabled) return;
  const d = b.dataset.pg === 'next' ? 1 : -1, w = b.closest('.pgw');
  if (w?.dataset.srv) { pgState[view] = Math.max((pgState[view] || 0) + d, 0); render(); return; }
  if (!w) return;
  const rows = [...w.querySelectorAll('tbody > tr')], n = rows.length, ps = PAGE_SIZE, last = Math.max(Math.ceil(n / ps) - 1, 0);
  const p = Math.min(Math.max((+w.dataset.pageIndex || 0) + d, 0), last); w.dataset.pageIndex = p;
  rows.forEach((r, i) => { r.hidden = !(i >= p * ps && i < (p + 1) * ps); });
  const t = w.querySelector('[data-all]'); if (t) t.textContent = pgText(p, ps, n);
  w.querySelector('[data-pg="prev"]').disabled = p <= 0; w.querySelector('[data-pg="next"]').disabled = p >= last;
  w.scrollIntoView?.({ block: 'nearest' });
});
const num = (k, t) => ({ k, t: t || (LABELS[k] || k), num: true, f: r => money(r[k]) });
const tag = (cls, t) => `<span class="tag t-${cls}">${esc(t)}</span>`;
const TYPES = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات' };
// نموذج الإضافة/الإصدار الرئيسي يُرفع إلى أعلى الشاشة (بعد العنوان والتبويبات) ويصير قابلاً للطي؛ الجدول يبقى أسفله.
// لا يلمس نماذج «تعديل …» ولا «تسوية …». يحرّك العناصر نفسها فتبقى المعرّفات والمعالجات كما هي.
const NEWFORM = /^(منتج|إضافة|إصدار|تسجيل|إنشاء|تقديم|طلب|عقد جديد|مورد جديد|مستخدم جديد|مالك جديد|فرع جديد|مستخدم|مورد)/;
const pinForm = main => {
  const kids = [...main.children];
  const card = kids.find(c => c.matches('.card.noprint') && !c.hidden && c.firstElementChild?.tagName === 'B' && NEWFORM.test(c.firstElementChild.textContent.trim()));
  if (!card) return;
  const after = kids.slice(0, kids.indexOf(card)).some(c => c.matches('.filter-bar,[id*="tbl"]') || c.querySelector('table,.scroll'));
  const ref = kids.find(c => !c.matches('.top,.printhead,.tabs,.geo-note'));
  const head = card.firstElementChild, d = document.createElement('details');
  d.className = 'card noprint newform'; d.open = true; if (card.id) d.id = card.id;
  const sm = document.createElement('summary'); sm.textContent = head.textContent.trim(); head.remove();
  while (card.firstChild) d.appendChild(card.firstChild);
  d.prepend(sm); if (after) main.insertBefore(d, ref && ref !== card ? ref : main.firstChild); else main.insertBefore(d, kids[kids.indexOf(card) + 1] || null);
  card.remove();
};
const done = main => { try { pinForm(main); } catch (e) { console.error('pinForm', e); } main.insertAdjacentHTML('beforeend', foot()); };

// ---- journal entry detail: ONE modal, reachable from the journal list and from every screen that shows a journal-entry reference ----
const jeLink = id => id ? `<a href="#" class="n" data-je="${esc(id)}" title="عرض تفاصيل القيد">#${esc(id)}</a>` : '—';
async function showJournal(id) {
  const j = await api('/journal/' + encodeURIComponent(id)), can = ['admin', 'accountant'].includes(me?.role);
  document.querySelector('dialog.jmodal')?.remove();
  const dlg = document.createElement('dialog'); dlg.className = 'app-modal jmodal';
  const cols = [{ k: 'code', t: 'الحساب' }, { k: 'name_ar', t: 'الاسم' }, { k: 'partner', t: 'الطرف' }, { k: 'currency_code', t: 'عملة' }, num('rate'), num('debit'), num('credit')];
  const dTot = j.lines.reduce((x, l) => x + Number(l.debit || 0), 0), cTot = j.lines.reduce((x, l) => x + Number(l.credit || 0), 0);
  dlg.innerHTML = `<div class="modal-header"><h3>قيد ${esc(j.entry_no)}${j.reversal_of ? ' ' + tag('closed', 'عكسي') : ''}</h3><button type="button" class="btn ghost sm" data-x aria-label="إغلاق">✕</button></div>
    <div class="sub" style="margin-bottom:8px"><span class="n">${esc(j.entry_date)}</span> — ${esc(j.memo)}${j.source_type ? ' — ' + esc(j.source_type) : ''}</div>
    <div class="sub n" dir="ltr" style="margin-bottom:8px">hash ${esc(String(j.row_hash || '').slice(0, 16))}… ← ${esc(String(j.prev_hash || '').slice(0, 16))}…</div>
    ${table(cols, j.lines, { count: false })}
    <div class="row" style="justify-content:space-between;margin-top:8px"><b>إجمالي المدين: <span class="n">${money(dTot)}</span></b><b>إجمالي الدائن: <span class="n">${money(cTot)}</span></b></div>
    <div class="row noprint" style="margin-top:12px"><button class="btn sm" data-pv>🖨️ طباعة سند القيد</button>${can && !j.reversed_by && !j.reversal_of ? '<button class="btn coral sm" data-rv>عكس القيد</button>' : ''}${j.reversed_by ? `<a href="#" class="n" data-je="${esc(j.reversed_by)}">القيد العكسي #${esc(j.reversed_by)}</a>` : ''}${j.reversal_of ? `<a href="#" class="n" data-je="${esc(j.reversal_of)}">القيد الأصلي #${esc(j.reversal_of)}</a>` : ''}</div>`;
  document.body.append(dlg); dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-x]')) dlg.close(); });
  dlg.querySelector('[data-pv]').onclick = () => {
    const vMeta = `
      <div class="p-meta-item"><span class="p-meta-label">رقم القيد:</span><span class="p-meta-val">${esc(j.entry_no)}</span></div>
      <div class="p-meta-item"><span class="p-meta-label">تاريخ القيد:</span><span class="p-meta-val">${esc(j.entry_date)}</span></div>
      <div class="p-meta-item"><span class="p-meta-label">المصدر / الفرع:</span><span class="p-meta-val">${esc(j.source_type || 'يدوي')} / ${esc(j.branch_name || 'المركز الرئيسي')}</span></div>
      <div class="p-meta-item"><span class="p-meta-label">البيان:</span><span class="p-meta-val">${esc(j.memo)}</span></div>`;
    const vTable = table([{ k: 'code', t: 'رمز الحساب' }, { k: 'name_ar', t: 'اسم الحساب' }, { k: 'partner', t: 'الطرف' }, { k: 'currency_code', t: 'عملة' }, num('debit'), num('credit')], j.lines, { count: false });
    const summary = `<table style="margin-top:10px"><tr class="tot"><td style="text-align:right">إجمالي المدين: ${money(dTot)} ر.س</td><td style="text-align:left">إجمالي الدائن: ${money(cTot)} ر.س</td></tr></table>`;
    printDoc(`سند قيد محاسبي (${j.entry_no})`, vTable + summary, { ref: j.entry_no, date: j.entry_date, meta: vMeta });
  };
  const rv = dlg.querySelector('[data-rv]'); if (rv) rv.onclick = guard(async () => { if (!confirm('سيُنشأ قيد عكسي بتاريخ اليوم. متابعة؟')) return; await api(`/journal/${j.id}/reverse`, { method: 'POST', body: { date: today() } }); dlg.close(); toast('تم العكس'); render(); });
}
document.addEventListener('click', e => { const a = e.target.closest?.('[data-je]'); if (!a) return; e.preventDefault(); guard(showJournal)(a.dataset.je); });

function renderAIVisual(v) {
  if (!v || !Array.isArray(v.metrics) && !Array.isArray(v.series)) return '';
  const metrics=(v.metrics||[]).map(([label,value])=>`<div class="ai-metric"><span>${esc(label)}</span><b>${esc(value??'—')}</b></div>`).join('');
  let chart='';
  if(v.kind==='series'&&Array.isArray(v.labels)&&Array.isArray(v.series)&&v.labels.length){
    const W=820,H=320,L=64,R=20,T=28,B=64,plotW=W-L-R,plotH=H-T-B,n=v.labels.length,series=v.series.slice(0,3),values=series.flatMap(s=>(s.values||[]).slice(0,n).map(x=>Number.isFinite(Number(x))?Number(x):0)),min=Math.min(0,...values),rawMax=Math.max(0,...values),max=rawMax===min?1:rawMax,span=max-min,zeroY=T+max/span*plotH,step=plotW/n,group=step*.68,bar=group/Math.max(1,series.length),colors=['#24496b','#71849a','#aab6c3'];
    const grid=[0,.5,1].map(f=>{const y=T+plotH*f,val=max-span*f;return `<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" class="ai-grid"/><text x="${L-8}" y="${y+4}" text-anchor="end" class="ai-axis">${esc(plainNumber(val,0))}</text>`}).join('');
    const bars=series.map((s,si)=>(s.values||[]).slice(0,n).map((raw,i)=>{const val=Number(raw)||0,h=Math.abs(val)/span*plotH,x=L+i*step+(step-group)/2+si*bar,y=val>=0?zeroY-h:zeroY;return `<rect x="${x}" y="${y}" width="${Math.max(2,bar-3)}" height="${Math.max(0,h)}" rx="3" fill="${colors[si]}"><title>${esc(s.name)} — ${esc(v.labels[i])}: ${esc(plainNumber(val))} ${esc(v.unit||'')}</title></rect>`}).join('')).join('');
    const labels=v.labels.map((label,i)=>`<text x="${L+i*step+step/2}" y="${H-30}" text-anchor="middle" class="ai-axis">${esc(String(label).slice(0,14))}</text>`).join('');
    const legend=series.map((s,i)=>`<span><i style="background:${colors[i]}"></i>${esc(s.name)}</span>`).join('');
    const dataRows = v.labels.map((label, i) => {
      const cells = series.map(s => {
        const value = plainNumber(s.values?.[i] ?? 0);
        return `<td class="num">${esc(value)} ${esc(v.unit || '')}</td>`;
      }).join('');
      return `<tr><td>${esc(label)}</td>${cells}</tr>`;
    }).join('');
    chart=`<figure class="ai-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(v.title)}">${grid}${bars}${labels}</svg><figcaption>${legend}</figcaption></figure><details class="ai-chart-data"><summary>عرض البيانات كجدول</summary><div class="scroll"><table><thead><tr><th>الفترة / البند</th>${series.map(s=>`<th>${esc(s.name)}${v.unit?` (${esc(v.unit)})`:''}</th>`).join('')}</tr></thead><tbody>${dataRows}</tbody></table></div></details>`;
  }
  return `<section class="ai-visual" aria-label="عرض مرئي للإجابة"><h3>${esc(v.title||'عرض مرئي للبيانات')}</h3>${metrics?`<div class="ai-metrics">${metrics}</div>`:''}${chart||(v.kind!=='metrics'?'<p class="sub">لا تتوفر نقاط كافية لرسم مخطط لهذا الملخص.</p>':'')}</section>`;
}

const VIEWS = {
  async hrsettings(m) {
    const can = ['admin','accountant'].includes(me.role);
    if (!can) { m.innerHTML = head('إعدادات الموظفين','هذه الشاشة متاحة لمسؤولي الموارد البشرية والمحاسبين.') + '<div class="card">لا تملك صلاحية تعديل إعدادات الموظفين.</div>'; done(m); return; }
    const data = await api('/hr/settings');
    const defs = {
      contracts:{label:'أنواع العقود',kind:'contracts',rows:data.contracts,fields:[['duration_months','مدة العقد (شهر)','number'],['probation_months','فترة التجربة (شهر)','number'],['renewable','قابل للتجديد (نعم/لا)','text']]},
      salaries:{label:'هياكل الرواتب',kind:'salaries',rows:data.salaries,fields:[['basic_salary','الراتب الأساسي','number'],['housing_allowance','بدل السكن','number'],['transport_allowance','بدل النقل','number'],['other_allowances','بدلات أخرى','number'],['gosi_deduction','خصم التأمينات','number']]},
      schedules:{label:'ساعات العمل المعتمدة',kind:'schedules',rows:data.schedules,fields:[['hours_per_day','ساعات العمل يوميًا','number'],['days_per_week','أيام العمل أسبوعيًا','number'],['start_time','بداية الدوام (HH:MM)','text'],['end_time','نهاية الدوام (HH:MM)','text']]}
    };
    let active='contracts', editId=null;
    const draw=()=>{
      const d=defs[active], fields=d.fields.map(([key,label,type])=>`<label>${label}<input id="hrf-${key}" type="${type}" ${type==='number'?'step="0.01" min="0"':''}></label>`).join('');
      m.innerHTML=head('إعدادات الموظفين والهيكل التنظيمي','إدارة أنواع العقود، مكونات الراتب، ساعات العمل، والتبعية الإدارية للموظفين.')+
        `<div class="card noprint"><div class="row">${Object.entries(defs).map(([k,v])=>`<button class="btn ${k===active?'teal':'ghost'} sm" data-tab="${k}">${v.label}</button>`).join('')}<button class="btn ${active==='org'?'teal':'ghost'} sm" data-tab="org">الهيكل التنظيمي</button></div></div>`+
        (active==='org'?orgView():catalogView(d,fields));
      m.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{active=b.dataset.tab;editId=null;draw();});
      if(active==='org'){wireOrg();return;}
      wireCatalog(d);
    };
    const catalogView=(d,fields)=>`<div class="card noprint"><b>${editId?'تعديل':'إضافة'} ${d.label}</b><div class="row"><label style="flex:1">الاسم *<input id="hrf-name" maxlength="120"></label>${fields}</div><label>الوصف والتفاصيل<textarea id="hrf-details" rows="2" maxlength="2000"></textarea></label><div class="row"><button class="btn teal" id="hrf-save">${editId?'حفظ التعديل':'إضافة'}</button><button class="btn ghost" id="hrf-cancel" ${editId?'':'hidden'}>إلغاء</button></div></div><div class="card">${table([{k:'name_ar',t:'الاسم'},{k:'details',t:'التفاصيل'},{t:'المعلمات',f:r=>esc(Object.entries(r.settings||{}).map(([k,v])=>`${k}: ${v}`).join('، '))},{t:'الإجراءات',f:r=>`<button class="btn ghost sm" data-edit="${r.id}">تعديل</button> <button class="btn coral sm" data-del="${r.id}">حذف</button>`}],d.rows)}</div>`;
    const wireCatalog=d=>{
      $('#hrf-save').onclick=guard(async()=>{const name_ar=$('#hrf-name').value.trim();if(!name_ar)throw new Error('اكتب اسم الإعداد');const settings={};for(const [key] of d.fields){const v=$(`#hrf-${key}`).value;if(v!=='')settings[key]=v;}const body={name_ar,details:$('#hrf-details').value,settings};await api(`/hr/settings/${d.kind}${editId?`/${editId}`:''}`,{method:editId?'PUT':'POST',body});toast('تم حفظ الإعداد');editId=null;render();});
      $('#hrf-cancel').onclick=()=>{editId=null;draw();};
      m.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const r=d.rows.find(x=>x.id===Number(b.dataset.edit));if(!r)return;editId=r.id;draw();$('#hrf-name').value=r.name_ar;$('#hrf-details').value=r.details||'';for(const [key] of d.fields)$(`#hrf-${key}`).value=r.settings?.[key]??'';});
      m.querySelectorAll('[data-del]').forEach(b=>b.onclick=guard(async()=>{if(!confirm('تأكيد حذف الإعداد؟'))return;await api(`/hr/settings/${d.kind}/${b.dataset.del}`,{method:'DELETE'});toast('تم حذف الإعداد');render();}));
    };
    const orgView=()=>{
      const emps=data.employees||[], children=id=>emps.filter(e=>String(e.manager_employee_id||'')===String(id||''));
      const node=(e,seen=new Set())=>{if(seen.has(e.id))return '';const next=new Set(seen);next.add(e.id);return `<li><div class="card" style="display:inline-block;min-width:220px;text-align:center"><b>${esc(e.name_ar)}</b><div class="sub">${esc(e.job_title||'—')} · ${esc(e.employee_no)}</div><div class="sub">${esc(e.department||'')}</div></div>${children(e.id).length?`<ul>${children(e.id).map(x=>node(x,next)).join('')}</ul>`:''}</li>`;};
      const roots=children('');
      return `<div class="card"><h3>المخطط التنظيمي</h3><p class="sub">يعرض الموظفين حسب المدير المباشر، على نمط المخطط المرفق.</p><div class="org-tree"><ul>${roots.map(e=>node(e)).join('')}${emps.filter(e=>!e.manager_employee_id&& !roots.some(r=>r.id===e.id)).map(e=>node(e)).join('')}</ul></div></div><div class="card"><h3>تحديد المدير المباشر وإعدادات الموظف</h3><div class="scroll"><table><thead><tr><th>الموظف</th><th>المدير المباشر</th><th>نوع العقد</th><th>هيكل الراتب</th><th>ساعات العمل</th><th>إجراء</th></tr></thead><tbody>${emps.map(e=>`<tr><td>${esc(e.name_ar)} <span class="sub">${esc(e.employee_no)}</span></td><td><select data-manager="${e.id}"><option value="">— بدون مدير —</option>${emps.filter(x=>x.id!==e.id).map(x=>`<option value="${x.id}" ${x.id===e.manager_employee_id?'selected':''}>${esc(x.name_ar)}</option>`).join('')}</select></td><td><select data-contract="${e.id}"><option value="">—</option>${data.contracts.map(x=>`<option value="${x.id}" ${x.id===e.contract_type_id?'selected':''}>${esc(x.name_ar)}</option>`).join('')}</select></td><td><select data-salary="${e.id}"><option value="">—</option>${data.salaries.map(x=>`<option value="${x.id}" ${x.id===e.salary_structure_id?'selected':''}>${esc(x.name_ar)}</option>`).join('')}</select></td><td><select data-schedule="${e.id}"><option value="">—</option>${data.schedules.map(x=>`<option value="${x.id}" ${x.id===e.work_schedule_id?'selected':''}>${esc(x.name_ar)}</option>`).join('')}</select></td><td><button class="btn teal sm" data-save-org="${e.id}">حفظ</button></td></tr>`).join('')}</tbody></table></div></div>`;
    };
    const wireOrg=()=>m.querySelectorAll('[data-save-org]').forEach(b=>b.onclick=guard(async()=>{const id=b.dataset.saveOrg;await api(`/employees/${id}/hr-settings`,{method:'PUT',body:{manager_employee_id:$(`[data-manager="${id}"]`).value,contract_type_id:$(`[data-contract="${id}"]`).value,salary_structure_id:$(`[data-salary="${id}"]`).value,work_schedule_id:$(`[data-schedule="${id}"]`).value}});toast('تم تحديث الهيكل وإعدادات الموظف');render();}));
    draw(); done(m);
  },
  async ['ai-assistant'](m) {
    const status = await api('/ai/status');
    m.innerHTML = head('مساعد OKLENT المحلي', 'يقرأ تقارير وملخصات محددة من قاعدة بيانات التطبيق على هذا الخادم. لا يتصل بخدمات خارجية ولا ينفذ معاملات أو تغييرات مالية.') +
      `<div class="card ai-status ${status.ready?'ready':'off'}"><b>${status.ready?'المساعد المحلي جاهز — قراءة فقط':'المساعد متوقف'}</b><p>${status.ready?'تُنفَّذ الاستعلامات المعتمدة داخل الخادم، مع صلاحيات الحساب وسجل تدقيق دون حفظ نص السؤال أو الإجابة. لا يلزم مفتاح أو إعداد مزود خارجي.':status.enabled?'الميزة المحلية معطلة من إعداد الخادم.':'الميزة متوقفة.'}</p></div>
      ${status.ready?`<div class="card ai-form"><div class="row"><label>نوع المساعدة<select id="ai-feature"><option value="report">استعلام من قاعدة البيانات</option><option value="documents">البحث في دليل الاستخدام</option><option value="rule">شرح قاعدة محاسبية</option><option value="invoice">شرح حالة فاتورة</option></select></label><label id="ai-rule-wrap" hidden>القاعدة<select id="ai-rule"></select></label><label id="ai-invoice-wrap" hidden>رقم الفاتورة<input id="ai-invoice" maxlength="40" placeholder="INV-2026-000001"></label><label id="ai-report-wrap" hidden>التقرير<select id="ai-report"><option value="auto">تحديد تلقائي من السؤال</option><option value="monthly">الإيرادات والمصروفات الشهرية</option><option value="invoices">الفواتير والمبالغ غير المحصلة</option><option value="inventory">أرصدة المخزون وتكلفته</option><option value="fleet">الأسطول والرحلات والوقود والصيانة</option><option value="receivables-aging">أعمار الذمم المدينة</option><option value="balance-sheet">المركز المالي</option><option value="vat-return">الإقرار الضريبي</option><option value="trial-balance">ميزان المراجعة</option><option value="income-statement">قائمة الدخل</option></select></label><label id="ai-from-wrap" hidden>من تاريخ<input type="date" id="ai-from" value="${fiscalStart()}"></label><label id="ai-to-wrap" hidden>إلى تاريخ<input type="date" id="ai-to" value="${today()}"></label></div><label class="ai-question-label">سؤالك أو ما تريد معرفته<textarea id="ai-question" rows="4" maxlength="4000" placeholder="مثال: قارن الإيرادات والمصروفات شهرياً، أو اعرض أعمار الذمم للفترة المحددة" required></textarea></label><div class="row ai-hint" id="ai-hint">سيختار التقرير من الكلمات الواضحة في السؤال، أو يمكنك تحديده يدوياً.</div><button class="btn teal" id="ai-send">استعلام محلي</button><span class="sub">المساعد محلي ومحدد الاستعلامات؛ لا يرسل بيانات للخارج ولا ينفذ أوامر مكتوبة في السؤال.</span></div><div class="card ai-answer" id="ai-answer" hidden></div>`:''}
      ${me.role==='admin'?'<div class="card"><button class="btn ghost" id="ai-audit-toggle">سجل استخدام المساعد</button><div id="ai-audit" hidden></div></div>':''}`;
    if(status.ready){
      const rulesData=await api('/rules'); $('#ai-rule').innerHTML=rulesData.rules.map(r=>`<option value="${esc(r.id)}">${esc(r.id)} — ${esc(r.ar)}</option>`).join('');
      const show=()=>{const f=$('#ai-feature').value;$('#ai-rule-wrap').hidden=f!=='rule';$('#ai-invoice-wrap').hidden=f!=='invoice';$('#ai-report-wrap').hidden=f!=='report';$('#ai-from-wrap').hidden=f!=='report';$('#ai-to-wrap').hidden=f!=='report';$('#ai-hint').textContent={documents:'سيبحث المساعد في مستندات الاستخدام المعتمدة فقط.',rule:'سيشرح المساعد القاعدة المختارة كما وردت في كتالوج النظام.',invoice:'يستخدم رقم الفاتورة ومبالغها وتواريخها فقط، ولا يرسل اسم العميل أو تفاصيل البنود.',report:'يستخدم ملخصات مجمعة من تقارير قاعدة البيانات. الحد الأقصى للفترة 366 يوماً.'}[f];};
      $('#ai-feature').onchange=show; show();
      $('#ai-send').onclick=guard(async()=>{const b=$('#ai-send');b.disabled=true;b.textContent='جارٍ إعداد الإجابة…';$('#ai-answer').hidden=true;try{const feature=$('#ai-feature').value,body={feature,question:$('#ai-question').value.trim()};if(feature==='rule')body.rule_id=$('#ai-rule').value;if(feature==='invoice')body.invoice_number=$('#ai-invoice').value.trim();if(feature==='report'){body.report_type=$('#ai-report').value;body.from=$('#ai-from').value;body.to=$('#ai-to').value;}const r=await api('/ai/ask',{method:'POST',body});$('#ai-answer').innerHTML=`<h3>الإجابة</h3><div class="ai-response">${esc(r.answer)}</div>${r.visualization?renderAIVisual(r.visualization):''}${r.sources?.length?`<div class="ai-sources"><b>المصادر</b><ul>${r.sources.map(s=>`<li>${esc(s.name)}</li>`).join('')}</ul></div>`:''}<small class="sub">معرّف الطلب: <span dir="ltr">${esc(r.request_id)}</span></small>`;$('#ai-answer').hidden=false;}finally{b.disabled=false;b.textContent='استعلام محلي';}});
    }
    if(me.role==='admin') $('#ai-audit-toggle').onclick=guard(async()=>{const box=$('#ai-audit');if(!box.hidden){box.hidden=true;return;}const rows=await api('/ai/audit?limit=100');box.innerHTML=rows.length?table([{k:'created_at',t:'التاريخ'},{k:'username',t:'المستخدم'},{k:'feature',t:'نوع الاستعلام'},{k:'model',t:'المحرك'},{k:'status',t:'الحالة'},{k:'duration_ms',t:'المدة (مللي ثانية)'},{k:'fail_code',t:'رمز الخطأ'}],rows):'<p>لا توجد طلبات مسجلة.</p>';box.hidden=false;});
    done(m);
  },
  async accounts(m) {
    const a = await api('/accounts'); const can = ['admin', 'accountant'].includes(me.role);
    m.innerHTML = head('دليل الحسابات السعودي', '1 أصول · 2 خصوم · 3 حقوق ملكية · 4 إيرادات · 5 مصروفات', '<button class="btn" id="pr-acc">🖨️ طباعة الدليل</button> <button class="btn ghost" id="x">CSV</button>') +
      `<div id="acc-edit-box"></div>
      <div class="card">${table([{ t: 'الرمز', f: r => `<b class="n">${r.code}</b>` }, { t: 'الاسم', f: r => `<span style="padding-inline-start:${(r.code.replace(/0+$/, '').length - 1) * 14}px">${r.is_postable ? '' : '<b>'}${esc(r.name_ar)}${r.is_postable ? '' : '</b>'}</span>` }, { k: 'name_en', t: 'English' }, { t: 'النوع', f: r => tag(r.type, TYPES[r.type]) }, { t: 'ترحيل', f: r => r.is_postable ? '✓' : 'رئيسي' }, { t: '', f: r => can ? `<span class="noprint"><button class="btn ghost sm" data-ea="${r.code}">تعديل</button></span>` : '' }], a)}</div>`;
    $('#x').onclick = () => csv('chart-of-accounts', a.map(r => ({ code: r.code, name_ar: r.name_ar, name_en: r.name_en, type: r.type })));
    $('#pr-acc').onclick = () => printDoc('دليل الحسابات المالي السعودي', table([{ k: 'code', t: 'رمز الحساب' }, { k: 'name_ar', t: 'اسم الحساب (عربي)' }, { k: 'name_en', t: 'English Name' }, { t: 'النوع', f: r => TYPES[r.type] }, { t: 'ترحيل', f: r => r.is_postable ? 'فرعي (يقبل الترحيل)' : 'رئيسي' }], a), { subtitle: 'شجرة الحسابات المعتمدة — OKLENT BUSINESS', signatures: false });
    m.querySelectorAll('[data-ea]').forEach(b => b.onclick = () => {
      const code = b.dataset.ea; const r = a.find(x => x.code === code); if (!r) return;
      $('#acc-edit-box').innerHTML = `<div class="card noprint"><b>تعديل الحساب: ${r.code}</b>
        <div class="row">
          <label>رمز الحساب<input value="${r.code}" disabled style="max-width:120px"></label>
          <label style="flex:2">الاسم بالعربية *<input id="ea-ar" value="${esc(r.name_ar)}"></label>
          <label style="flex:2">English Name<input id="ea-en" value="${esc(r.name_en || '')}"></label>
          <button class="btn teal" id="ea-save">حفظ التعديلات</button>
          <button class="btn ghost" id="ea-cancel">إلغاء</button>
        </div>
      </div>`;
      $('#ea-cancel').onclick = () => { $('#acc-edit-box').innerHTML = ''; };
      $('#ea-save').onclick = guard(async () => {
        await api('/accounts/' + code, { method: 'PUT', body: { name_ar: $('#ea-ar').value, name_en: $('#ea-en').value || undefined } });
        toast('تم تحديث الحساب بنجاح'); render();
      });
      $('#acc-edit-box').scrollIntoView?.({ behavior: 'smooth' });
    });
    done(m);
  },
  async journal(m) {
    const [list, acc, br] = await Promise.all([api(`/journal?limit=${PAGE_SIZE}&offset=${(pgState.journal || 0) * PAGE_SIZE}`), api('/accounts'), api('/branches')]);
    const post = acc.filter(a => a.is_postable); const opt = post.map(a => `<option value="${a.code}">${a.code} ${esc(a.name_ar)}</option>`).join('');
    m.innerHTML = head('قيود اليومية', 'قيد مزدوج — لا تعديل ولا حذف، التصحيح بقيد عكسي', '<button class="btn" id="pr-jnl">🖨️ طباعة سجل القيود</button>') +
      `<div class="card noprint"><b>قيد جديد</b><div class="row"><label>التاريخ<input type="date" id="jd" value="${today()}"></label><label>الفرع<select id="jb"><option value="">—</option>${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label><label style="flex:3">البيان<input id="jm"></label></div>
      <div id="jl"></div><div class="row"><button class="btn ghost" id="add">+ سطر</button><button class="btn teal" id="save">ترحيل القيد</button><span id="bal" class="tag t-open n"></span></div></div>
      <div class="card">${table([{ t: 'الرقم', f: r => `<a href="#" data-je="${r.id}" class="n" title="عرض تفاصيل القيد">${esc(r.entry_no)}</a>` }, { k: 'entry_date', t: 'التاريخ' }, { k: 'memo', t: 'البيان' }, { k: 'source_type', t: 'المصدر' }, num('total_base'), { t: '', f: r => r.reversal_of ? tag('closed', 'عكسي') : '' }], list, { total: list.total, srv: true })}</div>`;
    $('#pr-jnl').onclick = guard(async () => { const all = await api('/journal?limit=500'); printDoc('سجل قيود اليومية العامة', table([{ k: 'entry_no', t: 'رقم القيد' }, { k: 'entry_date', t: 'التاريخ' }, { k: 'memo', t: 'البيان' }, { k: 'source_type', t: 'المصدر' }, num('total_base')], all, { count: false }), { subtitle: `سجل القيود المحاسبية — ${all.length} من أصل ${all.total ?? all.length}` }); });
    const lines = $('#jl'); const addLine = () => lines.insertAdjacentHTML('beforeend', `<div class="row ln"><label style="flex:3">الحساب<select>${opt}</select></label><label>مدين<input type="number" step="0.01" min="0" class="d"></label><label>دائن<input type="number" step="0.01" min="0" class="c"></label><label>عملة<select class="cu"><option>SAR</option><option>USD</option><option>EUR</option><option>AED</option></select></label></div>`);
    addLine(); addLine(); $('#add').onclick = addLine;
    const bal = () => { let d = 0, c = 0; lines.querySelectorAll('.ln').forEach(l => { d += +l.querySelector('.d').value || 0; c += +l.querySelector('.c').value || 0; }); $('#bal').textContent = `مدين ${d.toFixed(2)} | دائن ${c.toFixed(2)} (بعملة السطر)`; };
    lines.oninput = bal;
    $('#save').onclick = guard(async () => { const ls = [...lines.querySelectorAll('.ln')].map(l => ({ account: l.querySelector('select').value, debit: l.querySelector('.d').value || 0, credit: l.querySelector('.c').value || 0, currency: l.querySelector('.cu').value })).filter(l => +l.debit || +l.credit);
      const r = await api('/journal', { method: 'POST', body: { date: $('#jd').value, memo: $('#jm').value, branch: $('#jb').value || undefined, lines: ls } }); toast('تم الترحيل #' + r.id); render(); });
    done(m);
  },
  async periods(m) {
    const p = await api('/periods'); const admin = me.role === 'admin';
    m.innerHTML = head('الفترات والإقفال', 'مفتوحة ← مغلقة ← مقفلة نهائياً. الإقفال بالتسلسل.', admin ? `<button class="btn amber" id="yc">إقفال سنة مالية…</button>` : '') + `<div class="card">${table([{ k: 'name', t: 'الفترة' }, { k: 'start_date', t: 'من' }, { k: 'end_date', t: 'إلى' }, { t: 'الحالة', f: r => tag(r.status, { open: 'مفتوحة', closed: 'مغلقة', locked: 'مقفلة' }[r.status]) },
      { t: '', f: r => `<span class="noprint">${r.status === 'open' ? `<button class="btn sm" data-a="close" data-i="${r.id}">إقفال</button>` : ''}${admin && r.status === 'closed' ? `<button class="btn ghost sm" data-a="reopen" data-i="${r.id}">إعادة فتح</button> <button class="btn coral sm" data-a="lock" data-i="${r.id}">قفل نهائي</button>` : ''}</span>` }], p)}</div>`;
    m.querySelectorAll('[data-a]').forEach(b => b.onclick = guard(async () => { const a = b.dataset.a; let body = {};
      if (a === 'reopen') { body.reason = prompt('سبب إعادة الفتح (إلزامي، يُسجَّل في التدقيق):'); if (!body.reason) return; }
      if (a === 'lock' && !confirm('القفل النهائي لا رجعة فيه. متابعة؟')) return;
      await api(`/periods/${b.dataset.i}/${a}`, { method: 'POST', body }); toast('تم'); render(); }));
    const yc = $('#yc'); if (yc) yc.onclick = guard(async () => { const y = prompt('السنة المالية (مثال 2026)؟ يُرحَّل صافي الربح إلى 3300 بقيد إقفال.'); if (!y) return; const r = await api('/year-close/' + y, { method: 'POST' }); toast('قيد الإقفال #' + r.entry_id); render(); }); done(m);
  },
  async currencies(m) {
    const { currencies: c, rates } = await api('/currencies');
    m.innerHTML = head('العملات وأسعار الصرف', 'السعر = ريال لكل وحدة أجنبية. الأسعار لا تُعدَّل، تُضاف بتاريخ جديد.') + `<div class="grid2"><div class="card">${table([{ k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'الاسم' }, { t: 'أساسية', f: r => r.is_base ? '✓' : '' }], c)}</div>
      <div class="card noprint"><b>إضافة سعر</b><div class="row"><label>العملة<select id="rc">${c.filter(x => !x.is_base).map(x => `<option>${x.code}</option>`).join('')}</select></label><label>التاريخ<input type="date" id="rd" value="${today()}"></label><label>السعر<input id="rr" type="number" step="0.0001"></label><button class="btn teal" id="rs">حفظ</button></div></div></div>
      <div class="card">${table([{ k: 'currency_code', t: 'عملة' }, { k: 'rate_date', t: 'التاريخ' }, num('rate')], rates)}</div>`;
    $('#rs').onclick = guard(async () => { await api('/rates', { method: 'POST', body: { currency_code: $('#rc').value, rate_date: $('#rd').value, rate: $('#rr').value } }); toast('تم'); render(); }); done(m);
  },
  async reports(m) {
    const acc = await api('/accounts'); const R = {
      'trial-balance': ['ميزان المراجعة', [{ k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'الحساب' }, num('opening'), num('period_debit'), num('period_credit'), num('closing_debit'), num('closing_credit')], true],
      'income-statement': ['قائمة الدخل', [{ k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'البند' }, { t: 'النوع', f: r => tag(r.type, TYPES[r.type]) }, num('amount')], true],
      'balance-sheet': ['قائمة المركز المالي', [{ t: 'القسم', f: r => tag(r.section, TYPES[r.section]) }, { k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'البند' }, num('amount')], false],
      'general-ledger': ['دفتر الأستاذ', [{ k: 'entry_date', t: 'التاريخ' }, { k: 'entry_no', t: 'القيد' }, { k: 'memo', t: 'البيان' }, { k: 'partner', t: 'الطرف' }, num('debit'), num('credit'), num('balance')], true],
      daybook: ['دفتر اليومية', [{ k: 'entry_date', t: 'التاريخ' }, { t: 'النوع', f: r => esc(({manual:'يدوي',invoice:'فاتورة',payment:'تحصيل',payroll:'استحقاق رواتب',payroll_payment:'صرف رواتب',expense:'مصروف',custody:'عهدة',custody_settle:'تسوية عهدة',year_close:'إقفال سنة'})[r.source_type] || r.source_type || '—') }, { k: 'entry_no', t: 'القيد' }, { k: 'memo', t: 'البيان' }, { k: 'account_code', t: 'الحساب' }, { k: 'account_name', t: 'اسم الحساب' }, num('debit'), num('credit')], true],
      'vat-return': ['ملخص إقرار ضريبة القيمة المضافة', [{ k: 'box', t: 'الخانة' }, { k: 'label_ar', t: 'البند' }, num('net'), num('vat')], true],
      'ar-aging': ['أعمار الذمم المدينة', [{ k: 'partner', t: 'العميل' }, { k: 'invoice_no', t: 'الفاتورة' }, { k: 'due_date', t: 'الاستحقاق' }, num('outstanding'), { k: 'bucket', t: 'الفئة' }], false] };
    m.innerHTML = head('التقارير المالية', '', '<button class="btn" id="pr">طباعة / PDF</button> <button class="btn ghost" id="cv">CSV</button>') +
      `<div class="card noprint"><div class="row"><label>النوع<select id="rk">${Object.entries(R).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label><label id="rs-wrap" style="display:none">القسم<select id="rs"><option value="">الكل</option><option value="asset">أصول</option><option value="liability">خصوم</option><option value="equity">حقوق ملكية</option></select></label><label id="ra" style="display:none">الحساب<select id="rac"><option value="">كل الحسابات</option>${acc.filter(a => a.is_postable).map(a => `<option value="${a.code}">${a.code} ${esc(a.name_ar)}</option>`).join('')}</select></label><label>من<input type="date" id="rf" value="${fiscalStart()}"></label><label>إلى<input type="date" id="rt" value="${today()}"></label>
      <button class="btn teal" id="go">عرض</button></div></div><div class="card" id="out"></div>`;
    let rows = [], shownRows = [];
    const reportFilters = () => { const parts = [`النوع: ${$('#rk').selectedOptions[0]?.text || ''}`, `الفترة: ${$('#rf').value} إلى ${$('#rt').value}`]; if ($('#rs').value) parts.push(`القسم: ${$('#rs').selectedOptions[0]?.text || ''}`); if ($('#rac').value) parts.push(`الحساب: ${$('#rac').selectedOptions[0]?.text || ''}`); return parts.join(' · '); };
    const go = guard(async () => { const k = $('#rk').value; const accountReports = ['trial-balance','income-statement','balance-sheet','general-ledger','daybook']; $('#ra').style.display = accountReports.includes(k) ? '' : 'none'; $('#rs-wrap').style.display = k === 'balance-sheet' ? '' : 'none';
      if (k === 'general-ledger' && !$('#rac').value) $('#rac').value = acc.find(a => a.is_postable)?.code || '';
      const params = new URLSearchParams({ from: $('#rf').value, to: $('#rt').value });
      if (['general-ledger','daybook'].includes(k) && $('#rac').value) params.set('account', $('#rac').value);
      rows = await api(`/reports/${k}?${params}`); const [t, cols] = R[k];
      shownRows = rows.filter(r => (!$('#rac').value || !['trial-balance','income-statement','balance-sheet'].includes(k) || String(r.code) === $('#rac').value) && (k !== 'balance-sheet' || !$('#rs').value || r.section === $('#rs').value)); let body = shownRows.map(r => ({ ...r }));
      let extra = '';
      if (k === 'income-statement') { const rv = shownRows.filter(r => r.type === 'revenue').reduce((s, r) => s + +r.amount, 0), ex = shownRows.filter(r => r.type === 'expense').reduce((s, r) => s + +r.amount, 0); extra = `<tr class="tot"><td colspan="3">صافي الربح (الخسارة)</td><td class="num">${money(rv - ex)}</td></tr>`; }
      if (k === 'balance-sheet') { const A = rows.filter(r => r.section === 'asset').reduce((s, r) => s + +r.amount, 0), LE = rows.filter(r => r.section !== 'asset').reduce((s, r) => s + +r.amount, 0); extra = `<tr class="tot"><td colspan="3">إجمالي الأصول</td><td class="num">${money(A)}</td></tr><tr class="tot"><td colspan="3">إجمالي الخصوم وحقوق الملكية</td><td class="num">${money(LE)}</td></tr><tr class="tot"><td colspan="3">الفرق (يجب 0.00)</td><td class="num">${money(A - LE)}</td></tr>`; }
      if (k === 'trial-balance') { const d = shownRows.reduce((s, r) => s + +r.closing_debit, 0), c = shownRows.reduce((s, r) => s + +r.closing_credit, 0); extra = `<tr class="tot"><td colspan="5">إجمالي الحسابات المعروضة</td><td class="num">${money(d)}</td><td class="num">${money(c)}</td></tr>`; }
      const tb = table(cols, body); $('#out').innerHTML = `<div class="printhead" style="display:block"><b>${t}</b> ${$('#rf').value} → ${$('#rt').value}</div><h3 style="margin-top:0">${t}</h3><div class="sub report-filter-summary">${esc(reportFilters())}</div>` + tb.replace('</tbody>', extra + '</tbody>'); });
    $('#go').onclick = go; $('#rk').onchange = go; $('#rs').onchange = go;
    $('#rac').onchange = go;
    $('#pr').onclick = () => { const k = $('#rk').value; const [t] = R[k]; printDoc(t, $('#out').innerHTML, { subtitle: reportFilters() }); };
    $('#cv').onclick = () => { if (shownRows.length) csv($('#rk').value, shownRows); }; go(); done(m);
  },
  async properties(m) {
    const [p, u, br] = await Promise.all([api('/properties'), api('/units'), api('/branches')]); const can = ['admin', 'accountant'].includes(me.role);
    m.innerHTML = head('العقارات والوحدات', 'العقار التجاري: ضريبة 15% · السكني: معفى من الضريبة', '<button class="btn" id="pr-props">🖨️ طباعة دليل العقارات</button>') +
      `<div id="prop-edit-box"></div>
      <div class="card"><b>العقارات</b>${table([{ k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'العقار' }, { t: 'النوع', f: r => r.kind === 'commercial' ? tag('liability', 'تجاري') : tag('asset', 'سكني') }, { k: 'city', t: 'المدينة' }, { k: 'units', t: 'وحدات' }, { t: '', f: r => can ? `<span class="noprint"><button class="btn ghost sm" data-ed-p="${r.id}">تعديل</button></span>` : '' }], p)}</div>
      <div class="card"><b>الوحدات الإيجارية</b>${table([{ k: 'property', t: 'العقار' }, { k: 'unit_no', t: 'الوحدة' }, { k: 'kind', t: 'النوع' }, { k: 'area_m2', t: 'المساحة' }, num('base_annual_rent'), { t: 'الحالة', f: r => r.active_lease ? tag('closed', 'مؤجرة') : tag('open', 'شاغرة') }, { t: '', f: r => can ? `<span class="noprint"><button class="btn ghost sm" data-ed-u="${r.id}">تعديل</button></span>` : '' }], u)}</div>
      ${can ? `<div class="card noprint"><b>إضافة عقار</b><div class="row"><label>الرمز<input id="pc"></label><label>الاسم<input id="pn"></label><label>النوع<select id="pk"><option value="commercial">تجاري</option><option value="residential">سكني</option></select></label><label>المدينة<input id="pt"></label><label>الفرع<select id="pb">${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label><button class="btn teal" id="pa">إضافة</button></div>
      <b>إضافة وحدة</b><div class="row"><label>العقار<select id="up">${p.map(x => `<option value="${x.id}">${esc(x.name_ar)}</option>`).join('')}</select></label><label>رقم الوحدة<input id="un"></label><label>المساحة م²<input id="ua" type="number"></label><label>الإيجار السنوي<input id="ur" type="number"></label><button class="btn teal" id="ua2">إضافة</button></div></div>` : ''}`;
    $('#pr-props').onclick = () => printDoc('دليل العقارات والوحدات', table([{ k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'اسم العقار' }, { t: 'النوع', f: r => r.kind === 'commercial' ? 'تجاري' : 'سكني' }, { k: 'city', t: 'المدينة' }, { k: 'units', t: 'عدد الوحدات' }], p), { subtitle: 'سجل الأملاك والعقارات' });
    if (can) {
      $('#pa').onclick = guard(async () => { await api('/properties', { method: 'POST', body: { code: $('#pc').value, name_ar: $('#pn').value, kind: $('#pk').value, city: $('#pt').value, branch: $('#pb').value } }); render(); });
      $('#ua2').onclick = guard(async () => { await api('/units', { method: 'POST', body: { property_id: $('#up').value, unit_no: $('#un').value, area_m2: $('#ua').value || null, base_annual_rent: $('#ur').value || null } }); render(); });
      m.querySelectorAll('[data-ed-p]').forEach(b => b.onclick = () => {
        const item = p.find(x => x.id === +b.dataset.edP); if (!item) return;
        $('#prop-edit-box').innerHTML = `<div class="card noprint"><b>تعديل بيانات العقار: ${esc(item.name_ar)}</b>
          <div class="row">
            <label style="flex:2">الاسم بالعربية<input id="ep-name" value="${esc(item.name_ar)}"></label>
            <label style="flex:2">الاسم بالإنجليزية<input id="ep-en" value="${esc(item.name_en || '')}"></label>
            <label>النوع<select id="ep-kind"><option value="commercial" ${item.kind === 'commercial' ? 'selected' : ''}>تجاري</option><option value="residential" ${item.kind === 'residential' ? 'selected' : ''}>سكني</option></select></label>
            <label>المدينة<input id="ep-city" value="${esc(item.city || '')}"></label>
            <button class="btn teal" id="ep-save">حفظ</button><button class="btn ghost" id="ep-cancel">إلغاء</button>
          </div></div>`;
        $('#ep-cancel').onclick = () => { $('#prop-edit-box').innerHTML = ''; };
        $('#ep-save').onclick = guard(async () => {
          await api('/properties/' + item.id, { method: 'PUT', body: { name_ar: $('#ep-name').value, name_en: $('#ep-en').value || undefined, kind: $('#ep-kind').value, city: $('#ep-city').value } });
          toast('تم تحديث بيانات العقار'); render();
        });
        $('#prop-edit-box').scrollIntoView?.({ behavior: 'smooth' });
      });
      m.querySelectorAll('[data-ed-u]').forEach(b => b.onclick = () => {
        const item = u.find(x => x.id === +b.dataset.edU); if (!item) return;
        $('#prop-edit-box').innerHTML = `<div class="card noprint"><b>تعديل الوحدة: ${esc(item.unit_no)} (${esc(item.property)})</b>
          <div class="row">
            <label>رقم الوحدة<input id="eu-no" value="${esc(item.unit_no)}"></label>
            <label>المساحة م²<input id="eu-area" type="number" step="0.01" value="${item.area_m2 || ''}"></label>
            <label>الإيجار السنوي<input id="eu-rent" type="number" step="0.01" value="${item.base_annual_rent || ''}"></label>
            <button class="btn teal" id="eu-save">حفظ</button><button class="btn ghost" id="eu-cancel">إلغاء</button>
          </div></div>`;
        $('#eu-cancel').onclick = () => { $('#prop-edit-box').innerHTML = ''; };
        $('#eu-save').onclick = guard(async () => {
          await api('/units/' + item.id, { method: 'PUT', body: { unit_no: $('#eu-no').value, area_m2: $('#eu-area').value || null, base_annual_rent: $('#eu-rent').value || null } });
          toast('تم تحديث بيانات الوحدة'); render();
        });
        $('#prop-edit-box').scrollIntoView?.({ behavior: 'smooth' });
      });
    }
    done(m);
  },
  async leases(m) {
    const [l, u, t] = await Promise.all([api('/leases'), api('/units'), api('/partners?kind=tenant')]); const can = ['admin', 'accountant'].includes(me.role);
    m.innerHTML = head('عقود الإيجار وجداول الأقساط', 'عقود الإيجار والجدولة الآلية للأقساط وإصدار الفواتير الدورية', '<button class="btn" id="pr-leases">🖨️ طباعة قائمة العقود</button>') +
      `<div class="card">${table([{ k: 'number', t: 'العقد' }, { k: 'property', t: 'العقار' }, { k: 'unit_no', t: 'الوحدة' }, { k: 'tenant', t: 'المستأجر' }, { k: 'start_date', t: 'من' }, { k: 'end_date', t: 'إلى' }, num('annual_rent'), { t: 'الأقساط', f: r => `${r.billed}/${r.installments}` }, { t: '', f: r => `<button class="btn sm" data-s="${r.id}">الجدول</button>` }], l)}</div><div id="sch"></div>
      ${can ? `<div class="card noprint"><b>عقد جديد (يُنشأ الجدول تلقائياً)</b><div class="row"><label>الوحدة<select id="lu">${u.map(x => `<option value="${x.id}">${esc(x.property)} / ${esc(x.unit_no)}</option>`).join('')}</select></label><label>المستأجر<select id="lt">${t.map(x => `<option value="${x.id}">${esc(x.name_ar)}</option>`).join('')}</select></label><label>من<input type="date" id="ls"></label><label>إلى<input type="date" id="le"></label><label>الإيجار السنوي<input id="la" type="number"></label><label>الدفع<select id="lf"><option value="monthly">شهري</option><option value="quarterly">ربع سنوي</option><option value="semiannual">نصف سنوي</option><option value="annual">سنوي</option></select></label><button class="btn teal" id="lc">إنشاء</button></div></div>` : ''}`;
    $('#pr-leases').onclick = () => printDoc('سجل عقود الإيجار', table([{ k: 'number', t: 'رقم العقد' }, { k: 'property', t: 'العقار' }, { k: 'unit_no', t: 'الوحدة' }, { k: 'tenant', t: 'المستأجر' }, { k: 'start_date', t: 'بداية العقد' }, { k: 'end_date', t: 'نهاية العقد' }, num('annual_rent')], l), { subtitle: 'سجل العقود الإيجارية القائمة' });
    if (can) $('#lc').onclick = guard(async () => { await api('/leases', { method: 'POST', body: { unit_id: $('#lu').value, tenant_id: $('#lt').value, start_date: $('#ls').value, end_date: $('#le').value, annual_rent: $('#la').value, payment_freq: $('#lf').value } }); toast('تم إنشاء العقد والجدول'); render(); });
    m.querySelectorAll('[data-s]').forEach(b => b.onclick = guard(async () => {
      const lease = l.find(x => x.id === +b.dataset.s);
      const s = await api(`/leases/${b.dataset.s}/schedule`);
      $('#sch').innerHTML = `<div class="card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <b>جدول أقساط العقد: ${esc(lease?.number || '')} — المستأجر: ${esc(lease?.tenant || '')}</b>
          <button class="btn sm noprint" id="pr-sch-btn">🖨️ طباعة جدول الأقساط</button>
        </div>
        ${table([{ k: 'seq', t: '#' }, { k: 'due_date', t: 'الاستحقاق' }, num('amount'), { k: 'vat_rate', t: '% ضريبة' }, { t: 'الفاتورة', f: r => r.invoice_no ? esc(r.invoice_no) : (can ? `<button class="btn amber sm" data-i="${r.id}">إصدار فاتورة</button>` : '—') }, num('outstanding')], s)}</div>`;
      $('#pr-sch-btn').onclick = () => {
        const lMeta = `
          <div class="p-meta-item"><span class="p-meta-label">رقم العقد:</span><span class="p-meta-val">${esc(lease?.number)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">المستأجر:</span><span class="p-meta-val">${esc(lease?.tenant)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">العقار / الوحدة:</span><span class="p-meta-val">${esc(lease?.property)} / ${esc(lease?.unit_no)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">مدة العقد:</span><span class="p-meta-val">${esc(lease?.start_date)} إلى ${esc(lease?.end_date)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">الإيجار السنوي:</span><span class="p-meta-val">${money(lease?.annual_rent)} ر.س</span></div>
        `;
        const lTable = table([{ k: 'seq', t: 'القسط' }, { k: 'due_date', t: 'تاريخ الاستحقاق' }, num('amount', 'مبلغ القسط'), { k: 'vat_rate', t: '% الضريبة' }, { k: 'invoice_no', t: 'رقم الفاتورة' }, num('outstanding', 'المتبقي')], s);
        printDoc(`جدول أقساط عقد الإيجار (${lease?.number})`, lTable, { ref: lease?.number, meta: lMeta, subtitle: 'جدول الدفعات والاستحقاقات الإيجارية' });
      };
      $('#sch').querySelectorAll('[data-i]').forEach(x => x.onclick = guard(async () => { const r = await api(`/rent-schedule/${x.dataset.i}/invoice`, { method: 'POST' }); toast('صدرت الفاتورة ' + r.number); b.click(); }));
    })); done(m);
  },
  async invoices(m) {
    const [inv, pt, br, tc, prodAll, stAll] = await Promise.all([api('/invoices?limit=500'), api('/partners'), api('/branches'), api('/tax-codes'), api('/products').catch(() => []), api('/stores').catch(() => [])]);
    const prods = prodAll.filter(p => p.is_active), stActive = stAll.filter(x => x.is_active);
    const can = ['admin', 'accountant', 'cashier'].includes(me.role);
    const K = { standard: 'ضريبية', simplified: 'مبسطة', credit: 'إشعار دائن', debit: 'إشعار مدين' };
    const totSales = inv.reduce((s, r) => s + (r.kind === 'credit' ? -Number(r.total||0) : Number(r.total||0)), 0);
    const totVat = inv.reduce((s, r) => s + (r.kind === 'credit' ? -Number(r.vat_amount||0) : Number(r.vat_amount||0)), 0);
    const totOut = inv.reduce((s, r) => s + Number(r.outstanding||0), 0);

    m.innerHTML = head('الفواتير الإلكترونية والتحصيل', 'إصدار وطباعة وقبض وإشعار دائن · ترقيم ICV تسلسلي بلا فجوات · ختم وتشفير PIH · رمز الاستجابة السريعة QR (المرحلة الأولى ZATCA).') +
      `      ${can ? `<div class="card noprint"><b>إصدار فاتورة جديدة</b>
        <div class="row">
          <label>النوع<select id="ik"><option value="standard">ضريبية (B2B)</option><option value="simplified">مبسطة (B2C)</option></select></label>
          <label style="flex:2">العميل<select id="ic"><option value="">— نقدي —</option>${pt.map(x => `<option value="${x.id}">${esc(x.name_ar)}</option>`).join('')}</select></label>
          <label>الفرع<select id="ib">${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label>
          <label>المخزن (لخصم الأصناف)<select id="ist">${stActive.map(x => `<option value="${x.id}">${esc(x.name_ar)}</option>`).join('')}</select></label>
          <label>تاريخ الفاتورة<input id="idt" type="date" value="${today()}" max="${today()}"></label>
          <label>تاريخ الاستحقاق (اختياري)<input id="idu" type="date"></label>
        </div>
        <div id="ilines"></div>
        <div class="row"><button class="btn ghost sm" id="iadd" type="button">＋ إضافة بند</button><button class="btn teal" id="ig">إصدار الفاتورة</button></div>
      </div>` : ''}
      <div class="kpi-grid">
        <div class="kpi"><span>إجمالي الفواتير</span><b>${inv.length}</b></div>
        <div class="kpi"><span>صافي المبيعات شامل الضريبة</span><b>${money(totSales)} ر.س</b></div>
        <div class="kpi"><span>إجمالي الضريبة (15%)</span><b>${money(totVat)} ر.س</b></div>
        <div class="kpi"><span>المتبقي للتحصيل</span><b>${money(totOut)} ر.س</b></div>
      </div>
      <div class="card noprint filter-bar">
        <div class="row">
          <label style="flex:2">بحث برقم الفاتورة أو العميل<input id="inv-q" placeholder="ابحث بالرقم أو اسم العميل..."></label>
          <label>نوع الفاتورة<select id="inv-k"><option value="">كل الأنواع</option><option value="standard">ضريبية (B2B)</option><option value="simplified">مبسطة (B2C)</option><option value="credit">إشعار دائن</option></select></label>
          <label>حالة السداد<select id="inv-s"><option value="">كل الحالات</option><option value="unpaid">مستحقة / متبقي</option><option value="paid">مدفوعة بالكامل</option></select></label>
          <label>من تاريخ<input type="date" id="inv-d1"></label>
          <label>إلى تاريخ<input type="date" id="inv-d2"></label>
          <button class="btn ghost" id="inv-dx" type="button" title="مسح التاريخ">مسح التاريخ</button>
        </div>
      </div>
      <div class="card" id="inv-tbl"></div>`;

    const renderTable = () => {
      const q = ($('#inv-q')?.value || '').toLowerCase().trim();
      const k = $('#inv-k')?.value;
      const s = $('#inv-s')?.value;
      const d1 = $('#inv-d1')?.value, d2 = $('#inv-d2')?.value;
      const filtered = inv.filter(r => {
        if (q && !(r.number?.toLowerCase().includes(q) || r.partner?.toLowerCase().includes(q))) return false;
        if (k && r.kind !== k) return false;
        const d = r.issue_date || String(r.issue_at).slice(0, 10); if (d1 && d < d1) return false; if (d2 && d > d2) return false;
        if (s === 'unpaid' && +r.outstanding <= 0) return false;
        if (s === 'paid' && +r.outstanding > 0) return false;
        return true;
      });

      $('#inv-tbl').innerHTML = table([
        { k: 'number', t: 'الرقم' },
        { t: 'النوع', f: r => K[r.kind] || r.kind },
        { k: 'partner', t: 'العميل' },
        { t: 'التاريخ', f: r => r.issue_date || r.issue_at.slice(0, 10) },
        num('subtotal'),
        num('vat_amount'),
        num('total'),
        num('outstanding'),
        { k: 'icv', t: 'ICV' },
        { t: 'الإجراءات', f: r => `<span class="noprint">
          <button class="btn sm" data-p="${r.id}" title="طباعة الفاتورة">طباعة</button>
          <button class="btn ghost sm" data-x="${r.id}" title="تنزيل XML">XML</button>
          ${r.kind !== 'credit' && +r.outstanding > 0 && can ? `<button class="btn teal sm" data-pay="${r.id}" data-o="${r.outstanding}">قبض</button>` : ''}
          ${r.kind !== 'credit' && ['admin', 'accountant'].includes(me.role) ? `<button class="btn coral sm" data-cn="${r.id}">إشعار دائن</button>` : ''}
        </span>` }
      ], filtered, { total: Math.max(inv.total ?? 0, inv.length), extra: Object.entries(K).map(([k, t]) => [t, filtered.filter(r => r.kind === k).length]).filter(x => x[1]).map(([t, c]) => `<span class="chip">${t} <b class="n">${c}</b></span>`).join('') });

      m.querySelectorAll('button[data-p]').forEach(b => b.onclick = guard(async () => {
        const r = await fetch(`/api/invoices/${b.dataset.p}/print`, { headers: { authorization: 'Bearer ' + token } });
        if (!r.ok) { const err=await r.json().catch(()=>({})); toast(err.error||'تعذرت طباعة الفاتورة',false); return; }
        const html=await r.text(), w = open('', '_blank'); if(!w){toast('اسمح بالنوافذ المنبثقة لطباعة الفاتورة',false);return;} w.document.write(html); w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 400);
      }));
      m.querySelectorAll('[data-x]').forEach(b => b.onclick = guard(async () => {
        const r = await fetch(`/api/invoices/${b.dataset.x}/xml`, { headers: { authorization: 'Bearer ' + token } });
        const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob());
        a.download = 'invoice-' + b.dataset.x + '.xml'; a.click();
      }));
      m.querySelectorAll('[data-pay]').forEach(b => b.onclick = guard(async () => {
        const a = prompt('مبلغ القبض (المتبقي ' + b.dataset.o + '):', b.dataset.o);
        if (!a) return;
        await api(`/invoices/${b.dataset.pay}/payments`, { method: 'POST', body: { amount: a, cash_account: '1121', method: 'bank' } });
        toast('تم القبض بنجاح'); render();
      }));
      m.querySelectorAll('[data-cn]').forEach(b => b.onclick = guard(async () => {
        const r = prompt('سبب إشعار الدائن (إلزامي):');
        if (!r) return;
        const x = await api('/invoices', { method: 'POST', body: { kind: 'credit', related_invoice_id: b.dataset.cn, reason: r } });
        toast('صدر إشعار دائن رقم ' + x.number); render();
      }));
    };

    renderTable();
    $('#inv-q')?.addEventListener('input', renderTable);
    $('#inv-k')?.addEventListener('change', renderTable);
    $('#inv-s')?.addEventListener('change', renderTable);
    ['#inv-d1', '#inv-d2'].forEach(x => $(x)?.addEventListener('change', renderTable));
    $('#inv-dx')?.addEventListener('click', () => { $('#inv-d1').value = ''; $('#inv-d2').value = ''; renderTable(); });

    if (can) {
      const ACC = [['4200', '4200 مبيعات البضائع والألعاب'], ['4300', '4300 الصيانة وما بعد البيع'], ['4100', '4100 الإيجار'], ['4900', '4900 إيرادات أخرى']];
      const rateOf = c => Number(tc.find(x => x.code === c)?.rate || 0);
      const lineHtml = () => `<div class="il"><div class="il-main">
        <label class="il-p">المنتج / الخدمة<select class="lp"><option value="">— بند حر —</option>${prods.map(p => `<option value="${p.id}">${esc(p.sku)} — ${esc(p.name_ar)}${p.kind === 'rental' ? ' (تأجير)' : p.kind === 'service' ? ' (خدمة)' : ''}</option>`).join('')}</select></label>
        <label class="il-d">الوصف<input class="ld" placeholder="وصف البند..."></label>
        <label>الكمية<input class="lq" type="number" min="0.0001" step="any" value="1"></label>
        <label>السعر للوحدة<input class="lpr" type="number" min="0" step="0.01"></label>
        <label>الضريبة<select class="lt">${tc.map(x => `<option value="${x.code}">${esc(x.name_ar)}</option>`).join('')}</select></label>
        <label>حساب الإيراد<select class="la">${ACC.map(([c, t]) => `<option value="${c}">${t}</option>`).join('')}</select></label>
        <button class="btn ghost sm lx" type="button" title="حذف البند">✕</button></div>
        <div class="il-rent" hidden><span class="il-tag">فترة الإيجار</span><label>من تاريخ<input class="lf" type="date"></label><label>إلى تاريخ<input class="lto" type="date"></label><span class="sub ldays"></span></div></div>`;
      const box = $('#ilines');
      const isRent = el => { const p = prods.find(x => x.id === +el.querySelector('.lp').value); return p?.kind === 'rental' || el.querySelector('.la').value === '4100'; };
      const calc = () => { let net = 0, vat = 0; box.querySelectorAll('.il').forEach(el => { const n = (+el.querySelector('.lq').value || 0) * (+el.querySelector('.lpr').value || 0); net += n; vat += n * rateOf(el.querySelector('.lt').value) / 100;
          const r = isRent(el); el.querySelector('.il-rent').hidden = !r; const f = el.querySelector('.lf').value, t = el.querySelector('.lto').value;
          el.querySelector('.ldays').textContent = r && f && t && t >= f ? `المدة: ${Math.round((new Date(t) - new Date(f)) / 864e5) + 1} يوم` : ''; });
      };
      const addLine = () => { box.insertAdjacentHTML('beforeend', lineHtml()); const el = box.lastElementChild;
        el.querySelector('.lp').onchange = () => { const p = prods.find(x => x.id === +el.querySelector('.lp').value); if (p) { el.querySelector('.ld').value = p.name_ar; el.querySelector('.lpr').value = p.sale_price; el.querySelector('.lt').value = p.tax_code; if ([...el.querySelector('.la').options].some(o => o.value === p.revenue_account)) el.querySelector('.la').value = p.revenue_account; } calc(); };
        el.querySelectorAll('input,select').forEach(x => x.addEventListener('input', calc)); el.querySelector('.la').addEventListener('change', calc);
        el.querySelector('.lx').onclick = () => { if (box.children.length > 1) { el.remove(); calc(); } }; calc(); };
      addLine(); $('#iadd').onclick = addLine;
      $('#ig').onclick = guard(async () => {
        const lines = [...box.querySelectorAll('.il')].map(el => { const rent = isRent(el); const pid = el.querySelector('.lp').value;
          return { product_id: pid ? +pid : undefined, description: el.querySelector('.ld').value, qty: el.querySelector('.lq').value, unit_price: el.querySelector('.lpr').value, tax_code: el.querySelector('.lt').value, revenue_account: el.querySelector('.la').value,
            period_from: rent ? el.querySelector('.lf').value || undefined : undefined, period_to: rent ? el.querySelector('.lto').value || undefined : undefined }; });
        for (const l of lines) if (l.period_from === undefined && l.revenue_account === '4100') return toast('حدّد فترة الإيجار (من/إلى) لبند الإيجار', false);
        const r = await api('/invoices', { method: 'POST', body: { kind: $('#ik').value, partner_id: $('#ic').value || undefined, branch: $('#ib').value, store_id: +$('#ist').value || undefined, invoice_date: $('#idt').value || undefined, due_date: $('#idu').value || undefined, lines } });
        toast('صدرت الفاتورة رقم ' + r.number + (Number(r.cogs) > 0 ? ' — وتم ترحيل تكلفة المبيعات ' + money(r.cogs) : ''));
        render();
      });
    }
    done(m);
  },
  async partners(m) {
    const p = await api('/partners'); const can = ['admin', 'accountant', 'cashier'].includes(me.role);
    m.innerHTML = head('العملاء والمستأجرون والموردون', 'سجل الشركاء التجاريين والأرقام الضريبية والسجلات التجارية', '<button class="btn" id="pr-parts">🖨️ طباعة الدليل</button> <button class="btn ghost" id="csv-parts">CSV</button>') +
      `<div id="part-edit-box"></div>
      <div class="card">${table([
        { k: 'name_ar', t: 'الاسم' },
        { k: 'kind', t: 'النوع' },
        { k: 'vat_number', t: 'الرقم الضريبي' },
        { k: 'cr_number', t: 'السجل التجاري' },
        { k: 'city', t: 'المدينة' },
        { k: 'phone', t: 'الجوال' },
        { t: '', f: r => can ? `<span class="noprint"><button class="btn ghost sm" data-pe="${r.id}">تعديل</button></span>` : '' }
      ], p)}</div>
      ${can ? `<div class="card noprint"><b>إضافة طرف جديد</b><div class="row">
        <label>النوع<select id="qk"><option value="customer">عميل</option><option value="tenant">مستأجر</option><option value="vendor">مورد</option></select></label>
        <label style="flex:2">الاسم *<input id="qn"></label>
        <label>الرقم الضريبي (15 رقم، يبدأ وينتهي بـ 3)<input id="qv" maxlength="15"></label>
        <label>السجل التجاري<input id="qcr"></label>
      </div><div class="row">
        <label>المدينة<input id="qc"></label>
        <label>الجوال<input id="qp"></label>
        <label style="flex:2">البريد الإلكتروني<input id="qe"></label>
        <button class="btn teal" id="qs">حفظ</button>
      </div></div>` : ''}`;
    $('#pr-parts').onclick = () => printDoc('دليل الشركاء والعملاء والموردين', table([{ k: 'name_ar', t: 'الاسم' }, { k: 'kind', t: 'النوع' }, { k: 'vat_number', t: 'الرقم الضريبي' }, { k: 'cr_number', t: 'السجل التجاري' }, { k: 'city', t: 'المدينة' }, { k: 'phone', t: 'الجوال' }], p), { subtitle: 'سجل الشركاء التجاريين المعتمدين' });
    $('#csv-parts').onclick = () => csv('partners', p);
    if (can) {
      $('#qs').onclick = guard(async () => {
        await api('/partners', { method: 'POST', body: { kind: $('#qk').value, name_ar: $('#qn').value, vat_number: $('#qv').value || undefined, cr_number: $('#qcr').value || undefined, city: $('#qc').value || undefined, phone: $('#qp').value || undefined, email: $('#qe').value || undefined } });
        toast('تمت إضافة الطرف'); render();
      });
      m.querySelectorAll('[data-pe]').forEach(b => b.onclick = () => {
        const item = p.find(x => x.id === +b.dataset.pe); if (!item) return;
        $('#part-edit-box').innerHTML = `<div class="card noprint"><b>تعديل الطرف: ${esc(item.name_ar)}</b>
          <div class="row">
            <label style="flex:2">الاسم<input id="ep-n" value="${esc(item.name_ar)}"></label>
            <label>الرقم الضريبي<input id="ep-v" maxlength="15" value="${esc(item.vat_number || '')}"></label>
            <label>السجل التجاري<input id="ep-c" value="${esc(item.cr_number || '')}"></label>
          </div>
          <div class="row">
            <label>المدينة<input id="ep-city" value="${esc(item.city || '')}"></label>
            <label>الجوال<input id="ep-ph" value="${esc(item.phone || '')}"></label>
            <label style="flex:2">البريد الإلكتروني<input id="ep-em" value="${esc(item.email || '')}"></label>
            <button class="btn teal" id="ep-sv">حفظ التعديلات</button>
            <button class="btn ghost" id="ep-cn">إلغاء</button>
          </div></div>`;
        $('#ep-cn').onclick = () => { $('#part-edit-box').innerHTML = ''; };
        $('#ep-sv').onclick = guard(async () => {
          await api('/partners/' + item.id, { method: 'PUT', body: { name_ar: $('#ep-n').value, vat_number: $('#ep-v').value || null, cr_number: $('#ep-c').value || null, city: $('#ep-city').value || null, phone: $('#ep-ph').value || null, email: $('#ep-em').value || null } });
          toast('تم تحديث بيانات الطرف'); render();
        });
        $('#part-edit-box').scrollIntoView?.({ behavior: 'smooth' });
      });
    }
    done(m);
  },
  async rules(m) {
    const { rules, triggers } = await api('/rules');
    m.innerHTML = head('مختبر القواعد المحاسبية داخل PostgreSQL', 'جرّب مخالفة كل قاعدة وشاهد رد قاعدة البيانات نفسها. كل المحاولات تُلغى تلقائياً (ROLLBACK).') +
      rules.map(r => `<div class="rule"><b>${r.id} — ${r.ar}</b> <span class="sub">${r.en}</span><p>${r.why_ar}<br><span class="sub">${r.why_en}</span></p>
        <div>Trigger: <code>${esc(r.trigger)}</code> · Function: <code>${r.fn}</code></div><div class="row noprint" style="margin-top:8px">${r.lab.map(l => `<button class="btn amber sm" data-l="${l}">⚡ جرّب: ${l}</button>`).join('')}<button class="btn ghost sm" data-src="${r.fn}">عرض كود الدالة</button></div><div id="res-${r.id}"></div></div>`).join('') +
      `<div class="card"><b>المشغّلات الفعلية في قاعدة البيانات (${triggers.length})</b>${table([{ k: 'tgname', t: 'المشغّل' }, { k: 'tbl', t: 'الجدول' }, { k: 'fn', t: 'الدالة' }, { t: 'مفعّل', f: r => r.tgenabled === 'O' ? '✓' : '✗' }], triggers)}</div>`;
    m.querySelectorAll('[data-l]').forEach(b => b.onclick = guard(async () => { const r = await api('/rules/try/' + b.dataset.l, { method: 'POST' }); const box = b.closest('.rule').querySelector('[id^=res-]');
      box.innerHTML = `<p>${r.blocked ? tag('ok', 'رفضتها قاعدة البيانات ✓') : tag('bad', 'قُبلت! (خلل)')}</p><pre>${esc(r.statement)}</pre><pre>SQLSTATE ${esc(r.sqlstate)}\n${esc(r.message)}</pre>`; }));
    m.querySelectorAll('[data-src]').forEach(b => b.onclick = guard(async () => { const r = await api('/rules/source/' + b.dataset.src); b.closest('.rule').querySelector('[id^=res-]').innerHTML = `<pre>${esc(r.src)}</pre>`; })); done(m);
  },
  async doc(m) {
    const d = await api('/docs/' + view.slice(4)); m.innerHTML = `<div class="card doc">${d.html}</div>`; done(m);
  },
  async employees(m) {
    const [emps, br] = await Promise.all([api('/employees'), api('/branches')]);
    const can = ['admin', 'accountant'].includes(me.role);
    const ST = { active: ['ok', 'نشط'], suspended: ['locked', 'موقوف'], terminated: ['closed', 'منتهي'] };
    const totalSalary = emps.reduce((s, e) => s + Number(e.basic_salary || 0), 0);
    m.innerHTML = head('الموظفون وشؤون العمل', 'سجل الموظفين، الرواتب والبدلات، الحسابات البنكية، والربط مع الفروع ومراكز التكلفة.', '<button class="btn" id="pr-emps">🖨️ طباعة كشف الموظفين</button> <button class="btn ghost" id="csv-emps">CSV</button>') +
      `<div class="kpi-grid"><div class="kpi"><span>إجمالي الموظفين</span><b>${emps.length}</b></div><div class="kpi"><span>الموظفون النشطون</span><b>${emps.filter(e => e.status === 'active').length}</b></div><div class="kpi"><span>إجمالي الرواتب الأساسية</span><b>${money(totalSalary)} ر.س</b></div></div>
      <div id="emp-edit-box"></div>
      <div class="card noprint filter-bar"><div class="row"><label style="flex:2">بحث بالاسم أو الرقم<input id="eq" placeholder="ابحث بالاسم أو الرقم الوظيفي أو الهوية..."></label><label>الفرع<select id="eb"><option value="">كل الفروع</option>${br.map(b => `<option value="${b.id}">${esc(b.name_ar)}</option>`).join('')}</select></label><label>الحالة<select id="es"><option value="">كل الحالات</option><option value="active">نشط</option><option value="suspended">موقوف</option><option value="terminated">منتهي</option></select></label></div></div>
      <div class="card" id="emp-tbl"></div>
      ${can ? `<div class="card noprint"><b>إضافة موظف جديد</b>
        <div class="row"><label>الرقم الوظيفي (تلقائي إن تُرك فارغاً)<input id="e-no" placeholder="EMP-0001"></label><label style="flex:2">الاسم بالعربية *<input id="e-ar" required></label><label style="flex:2">الاسم بالإنجليزية<input id="e-en"></label><label>الهوية الوطنية / الإقامة<input id="e-nid" maxlength="10"></label></div>
        <div class="row"><label>الفرع<select id="e-br">${br.map(b => `<option value="${b.id}">${esc(b.name_ar)}</option>`).join('')}</select></label><label>القسم<input id="e-dept" placeholder="الإدارة / المبيعات / التشغيل"></label><label>المسمى الوظيفي<input id="e-job" placeholder="محاسب / فني / بائع"></label><label>تاريخ المباشرة<input type="date" id="e-hire" value="${today()}"></label></div>
        <div class="row"><label>الراتب الأساسي<input type="number" step="0.01" id="e-sal" value="0"></label><label>بدل سكن<input type="number" step="0.01" id="e-house" value="0"></label><label>بدل نقل<input type="number" step="0.01" id="e-trans" value="0"></label><label>بدلات أخرى<input type="number" step="0.01" id="e-other" value="0"></label></div>
        <div class="row"><label>خصم التأمينات GOSI<input type="number" step="0.01" id="e-gosi" value="0"></label><label>استقطاعات أخرى<input type="number" step="0.01" id="e-ded" value="0"></label><label>اسم البنك<input id="e-bnk" placeholder="الأهلي / الراجحي / الرياض"></label><label style="flex:2">آيبان IBAN<input id="e-iban" placeholder="SA..."></label></div>
        <div class="row"><label>الجوال<input id="e-ph"></label><label>البريد الإلكتروني<input id="e-em"></label><label>طريقة الصرف<select id="e-pm"><option value="bank">تحويل بنكي</option><option value="cash">نقداً</option><option value="cheque">شيك</option></select></label><button class="btn teal" id="e-save">حفظ الموظف</button></div>
      </div>` : ''}`;

    $('#pr-emps').onclick = () => printDoc('سجل الموظفين وكشف الرواتب', table([{ k: 'employee_no', t: 'الرقم' }, { k: 'name_ar', t: 'الاسم' }, { k: 'job_title', t: 'المسمى' }, { k: 'branch_name', t: 'الفرع' }, num('basic_salary', 'الأساسي'), num('housing_allowance', 'سكن'), num('transport_allowance', 'نقل'), num('other_allowances', 'أخرى'), num('gosi_deduction', 'تأمينات')], emps), { subtitle: 'سجل موظفي الشركة وهيكل الأجور' });
    $('#csv-emps').onclick = () => csv('employees', emps);

    const renderTbl = () => {
      const q = ($('#eq')?.value || '').toLowerCase().trim();
      const b = $('#eb')?.value;
      const s = $('#es')?.value;
      const filtered = emps.filter(e => {
        if (q && !(e.name_ar?.toLowerCase().includes(q) || e.employee_no?.toLowerCase().includes(q) || e.national_id?.includes(q))) return false;
        if (b && String(e.branch_id) !== b) return false;
        if (s && e.status !== s) return false;
        return true;
      });
      $('#emp-tbl').innerHTML = table([
        { k: 'employee_no', t: 'الرقم' },
        { k: 'name_ar', t: 'الاسم' },
        { k: 'branch_name', t: 'الفرع' },
        { k: 'job_title', t: 'المسمى' },
        { t: 'الراتب الإجمالي', f: r => me.role === 'viewer' ? '—' : money(Number(r.basic_salary||0) + Number(r.housing_allowance||0) + Number(r.transport_allowance||0) + Number(r.other_allowances||0)) },
        { t: 'التأمينات', f: r => me.role === 'viewer' ? '—' : money(r.gosi_deduction) },
        { t: 'الحالة', f: r => tag(...(ST[r.status] || ['closed', r.status])) },
        { t: 'الإجراءات', f: r => `<span class="noprint">
          <button class="btn ghost sm" data-card="${r.id}" title="بطاقة موظف وبيان راتب">🖨️ بطاقة</button>
          ${can ? `<button class="btn ghost sm" data-ee="${r.id}">تعديل</button>
          ${r.status === 'active' ? `<button class="btn coral sm" data-susp="${r.id}">إيقاف</button>` : `<button class="btn teal sm" data-act="${r.id}">تنشيط</button>`}` : ''}
        </span>` }
      ], filtered);

      m.querySelectorAll('[data-card]').forEach(btn => btn.onclick = () => {
        const r = emps.find(x => x.id === +btn.dataset.card); if (!r) return;
        const eMeta = `
          <div class="p-meta-item"><span class="p-meta-label">الرقم الوظيفي:</span><span class="p-meta-val">${esc(r.employee_no)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">الاسم بالعربية:</span><span class="p-meta-val">${esc(r.name_ar)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">الهوية / الإقامة:</span><span class="p-meta-val">${esc(r.national_id || '—')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">الفرع:</span><span class="p-meta-val">${esc(r.branch_name || 'المركز الرئيسي')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">المسمى الوظيفي:</span><span class="p-meta-val">${esc(r.job_title || '—')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">القسم:</span><span class="p-meta-val">${esc(r.department || '—')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">تاريخ المباشرة:</span><span class="p-meta-val">${esc(r.hire_date || '—')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">الحالة الوظيفية:</span><span class="p-meta-val">${r.status === 'active' ? 'نشط على رأس العمل' : r.status}</span></div>
        `;
        const salTable = `
          <table>
            <thead><tr><th>بند الراتب / المستحقات</th><th class="num">المبلغ (ر.س)</th><th>بند الاستقطاع</th><th class="num">المبلغ (ر.س)</th></tr></thead>
            <tbody>
              <tr><td>الراتب الأساسي</td><td class="num">${money(r.basic_salary)}</td><td>تأمينات GOSI (حصة الموظف)</td><td class="num">${money(r.gosi_deduction)}</td></tr>
              <tr><td>بدل السكن</td><td class="num">${money(r.housing_allowance)}</td><td>استقطاعات أخرى</td><td class="num">${money(r.other_deductions)}</td></tr>
              <tr><td>بدل النقل</td><td class="num">${money(r.transport_allowance)}</td><td>—</td><td class="num">—</td></tr>
              <tr><td>بدلات أخرى</td><td class="num">${money(r.other_allowances)}</td><td>—</td><td class="num">—</td></tr>
              <tr class="tot">
                <td>إجمالي الراتب (Gross)</td>
                <td class="num">${money(Number(r.basic_salary||0)+Number(r.housing_allowance||0)+Number(r.transport_allowance||0)+Number(r.other_allowances||0))}</td>
                <td>صافي الراتب المستحق</td>
                <td class="num">${money((Number(r.basic_salary||0)+Number(r.housing_allowance||0)+Number(r.transport_allowance||0)+Number(r.other_allowances||0))-(Number(r.gosi_deduction||0)+Number(r.other_deductions||0)))}</td>
              </tr>
            </tbody>
          </table>
          <div class="p-meta" style="margin-top:12px">
            <div class="p-meta-item"><span class="p-meta-label">البنك المعتمد:</span><span class="p-meta-val">${esc(r.bank_name || '—')}</span></div>
            <div class="p-meta-item"><span class="p-meta-label">رقم الحساب (IBAN):</span><span class="p-meta-val" dir="ltr">${esc(r.iban || '—')}</span></div>
            <div class="p-meta-item"><span class="p-meta-label">طريقة الصرف:</span><span class="p-meta-val">${r.payment_method === 'bank' ? 'تحويل بنكي' : r.payment_method}</span></div>
          </div>
        `;
        printDoc(`بطاقة موظف وبيان الراتب (${r.name_ar})`, salTable, { ref: r.employee_no, meta: eMeta, subtitle: 'سجل الموظف وهيكل الراتب المعتمد' });
      });

      m.querySelectorAll('[data-ee]').forEach(btn => btn.onclick = () => {
        const r = emps.find(x => x.id === +btn.dataset.ee); if (!r) return;
        $('#emp-edit-box').innerHTML = `<div class="card noprint"><b>تعديل بيانات الموظف: ${esc(r.name_ar)} (${r.employee_no})</b>
          <div class="row">
            <label style="flex:2">الاسم بالعربية *<input id="ee-ar" value="${esc(r.name_ar)}"></label>
            <label style="flex:2">الاسم بالإنجليزية<input id="ee-en" value="${esc(r.name_en || '')}"></label>
            <label>الهوية / الإقامة<input id="ee-nid" maxlength="10" value="${esc(r.national_id || '')}"></label>
            <label>الفرع<select id="ee-br">${br.map(b => `<option value="${b.id}" ${b.id === r.branch_id ? 'selected' : ''}>${esc(b.name_ar)}</option>`).join('')}</select></label>
          </div>
          <div class="row">
            <label>القسم<input id="ee-dept" value="${esc(r.department || '')}"></label>
            <label>المسمى الوظيفي<input id="ee-job" value="${esc(r.job_title || '')}"></label>
            <label>الراتب الأساسي<input type="number" step="0.01" id="ee-sal" value="${r.basic_salary}"></label>
            <label>بدل سكن<input type="number" step="0.01" id="ee-house" value="${r.housing_allowance}"></label>
          </div>
          <div class="row">
            <label>بدل نقل<input type="number" step="0.01" id="ee-trans" value="${r.transport_allowance}"></label>
            <label>بدلات أخرى<input type="number" step="0.01" id="ee-other" value="${r.other_allowances}"></label>
            <label>خصم التأمينات GOSI<input type="number" step="0.01" id="ee-gosi" value="${r.gosi_deduction}"></label>
            <label>استقطاعات أخرى<input type="number" step="0.01" id="ee-ded" value="${r.other_deductions}"></label>
          </div>
          <div class="row">
            <label>البنك<input id="ee-bnk" value="${esc(r.bank_name || '')}"></label>
            <label style="flex:2">IBAN<input id="ee-iban" value="${esc(r.iban || '')}"></label>
            <label>الجوال<input id="ee-ph" value="${esc(r.phone || '')}"></label>
            <label>البريد<input id="ee-em" value="${esc(r.email || '')}"></label>
            <label>الصرف<select id="ee-pm"><option value="bank" ${r.payment_method === 'bank' ? 'selected' : ''}>تحويل بنكي</option><option value="cash" ${r.payment_method === 'cash' ? 'selected' : ''}>نقداً</option><option value="cheque" ${r.payment_method === 'cheque' ? 'selected' : ''}>شيك</option></select></label>
            <button class="btn teal" id="ee-save">حفظ التعديلات</button>
            <button class="btn ghost" id="ee-cancel">إلغاء</button>
          </div></div>`;
        $('#ee-cancel').onclick = () => { $('#emp-edit-box').innerHTML = ''; };
        $('#ee-save').onclick = guard(async () => {
          await api('/employees/' + r.id, {
            method: 'PUT',
            body: {
              name_ar: $('#ee-ar').value,
              name_en: $('#ee-en').value || undefined,
              national_id: $('#ee-nid').value || undefined,
              branch_id: $('#ee-br').value || undefined,
              department: $('#ee-dept').value || undefined,
              job_title: $('#ee-job').value || undefined,
              basic_salary: $('#ee-sal').value,
              housing_allowance: $('#ee-house').value,
              transport_allowance: $('#ee-trans').value,
              other_allowances: $('#ee-other').value,
              gosi_deduction: $('#ee-gosi').value,
              other_deductions: $('#ee-ded').value,
              bank_name: $('#ee-bnk').value || undefined,
              iban: $('#ee-iban').value || undefined,
              phone: $('#ee-ph').value || undefined,
              email: $('#ee-em').value || undefined,
              payment_method: $('#ee-pm').value
            }
          });
          toast('تم تحديث بيانات الموظف بنجاح'); render();
        });
        $('#emp-edit-box').scrollIntoView?.({ behavior: 'smooth' });
      });

      m.querySelectorAll('[data-susp]').forEach(btn => btn.onclick = guard(async () => {
        if (!confirm('تأكيد إيقاف الموظف؟')) return;
        await api('/employees/' + btn.dataset.susp, { method: 'PUT', body: { status: 'suspended' } });
        toast('تم إيقاف الموظف'); render();
      }));
      m.querySelectorAll('[data-act]').forEach(btn => btn.onclick = guard(async () => {
        await api('/employees/' + btn.dataset.act, { method: 'PUT', body: { status: 'active' } });
        toast('تم تنشيط الموظف'); render();
      }));
    };

    renderTbl();
    $('#eq')?.addEventListener('input', renderTbl);
    $('#eb')?.addEventListener('change', renderTbl);
    $('#es')?.addEventListener('change', renderTbl);

    if (can) $('#e-save').onclick = guard(async () => {
      await api('/employees', {
        method: 'POST',
        body: {
          employee_no: $('#e-no').value || undefined,
          name_ar: $('#e-ar').value,
          name_en: $('#e-en').value || undefined,
          national_id: $('#e-nid').value || undefined,
          branch_id: $('#e-br').value || undefined,
          department: $('#e-dept').value || undefined,
          job_title: $('#e-job').value || undefined,
          hire_date: $('#e-hire').value || undefined,
          basic_salary: $('#e-sal').value,
          housing_allowance: $('#e-house').value,
          transport_allowance: $('#e-trans').value,
          other_allowances: $('#e-other').value,
          gosi_deduction: $('#e-gosi').value,
          other_deductions: $('#e-ded').value,
          bank_name: $('#e-bnk').value || undefined,
          iban: $('#e-iban').value || undefined,
          phone: $('#e-ph').value || undefined,
          email: $('#e-em').value || undefined,
          payment_method: $('#e-pm').value
        }
      });
      toast('تمت إضافة الموظف بنجاح');
      render();
    });
    done(m);
  },
  async fleet(m) {
    const [vehicles, trips, fuel, maintenance, employees, branches] = await Promise.all([
      api('/fleet/vehicles'), api('/fleet/trips'), api('/fleet/fuel'), api('/fleet/maintenance'), api('/employees'), api('/branches')
    ]);
    const can = ['admin', 'accountant'].includes(me.role);
    const vehicleOptions = vehicles.map(v => `<option value="${v.id}">${esc(v.plate_no)} — ${esc(v.make)} ${esc(v.model)}</option>`).join('');
    const employeeOptions = employees.filter(e => e.status === 'active').map(e => `<option value="${e.id}">${esc(e.name_ar)} — ${esc(e.employee_no)}</option>`).join('');
    const statusLabel = { active: 'نشطة', in_service: 'في الصيانة', inactive: 'متوقفة', sold: 'مباعة' };
    m.innerHTML = head('إدارة الأسطول', 'سجل المركبات والرحلات والوقود والصيانة ومواعيد التجديد.', '<button class="btn" id="fl-pr">🖨️ طباعة المركبات</button> <button class="btn ghost" id="fl-csv">CSV</button>') +
      `<div class="kpi-grid"><div class="kpi"><span>المركبات النشطة</span><b>${vehicles.filter(v => v.status === 'active').length}</b></div><div class="kpi"><span>الرحلات المسجلة</span><b>${trips.length}</b></div><div class="kpi"><span>تكلفة الوقود</span><b>${money(fuel.reduce((s,r)=>s+Number(r.total_amount||0),0))} ر.س</b></div><div class="kpi"><span>تكلفة الصيانة</span><b>${money(maintenance.reduce((s,r)=>s+Number(r.cost||0),0))} ر.س</b></div></div>
      <div class="card noprint filter-bar"><div class="row"><label style="flex:2">بحث عن مركبة<input id="fl-q" placeholder="رقم اللوحة أو الصانع أو الطراز"></label><label>الحالة<select id="fl-status"><option value="">كل الحالات</option><option value="active">نشطة</option><option value="in_service">في الصيانة</option><option value="inactive">متوقفة</option><option value="sold">مباعة</option></select></label><label>الفرع<select id="fl-branch"><option value="">كل الفروع</option>${branches.map(b=>`<option value="${b.id}">${esc(b.name_ar)}</option>`).join('')}</select></label></div></div>
      <div class="card" id="fl-vehicles"></div>
      ${can ? `<div class="card noprint"><details open><summary><b>إضافة مركبة</b></summary><div class="row"><label>رقم اللوحة *<input id="fl-plate" required></label><label>رقم الهيكل<input id="fl-vin"></label><label>الصانع *<input id="fl-make" required></label><label>الطراز *<input id="fl-model" required></label><label>سنة الصنع<input id="fl-year" type="number" min="1950" max="2100"></label><label>النوع<select id="fl-type"><option value="car">سيارة</option><option value="van">فان</option><option value="truck">شاحنة</option><option value="bus">حافلة</option><option value="motorcycle">دراجة</option><option value="equipment">معدات</option><option value="other">أخرى</option></select></label></div>
        <div class="row"><label>الملكية<select id="fl-own"><option value="owned">مملوكة</option><option value="leased">مؤجرة بعقد</option><option value="rented">إيجار</option></select></label><label>الحالة<select id="fl-new-status"><option value="active">نشطة</option><option value="in_service">في الصيانة</option><option value="inactive">متوقفة</option></select></label><label>الفرع<select id="fl-new-branch"><option value="">بدون فرع</option>${branches.map(b=>`<option value="${b.id}">${esc(b.name_ar)}</option>`).join('')}</select></label><label>المسؤول<select id="fl-driver"><option value="">غير محدد</option>${employeeOptions}</select></label><label>قراءة العداد<input id="fl-odo" type="number" min="0" step="0.1" value="0"></label></div>
        <div class="row"><label>انتهاء الاستمارة<input id="fl-reg" type="date"></label><label>انتهاء التأمين<input id="fl-ins" type="date"></label><label>موعد الفحص القادم<input id="fl-inspect" type="date"></label><label style="flex:2">ملاحظات<input id="fl-notes"></label><button class="btn teal" id="fl-save">حفظ المركبة</button></div></details></div>
      <div class="grid2"><div class="card noprint"><b>تسجيل رحلة</b><div class="row"><label>المركبة<select id="trip-v">${vehicleOptions}</select></label><label>السائق<select id="trip-d"><option value="">غير محدد</option>${employeeOptions}</select></label><label>التاريخ<input type="date" id="trip-date" value="${today()}"></label></div><div class="row"><label>من<input id="trip-from" required></label><label>إلى<input id="trip-to" required></label><label>الغرض<input id="trip-purpose" required></label></div><div class="row"><label>عداد البداية<input id="trip-start" type="number" min="0" step="0.1" required></label><label>عداد النهاية<input id="trip-end" type="number" min="0" step="0.1"></label><label>الحالة<select id="trip-status"><option value="completed">مكتملة</option><option value="planned">مخططة</option></select></label><button class="btn teal" id="trip-save">حفظ الرحلة</button></div></div>
      <div class="card noprint"><b>تسجيل تعبئة وقود</b><div class="row"><label>المركبة<select id="fuel-v">${vehicleOptions}</select></label><label>التاريخ<input type="date" id="fuel-date" value="${today()}"></label><label>النوع<select id="fuel-type"><option value="petrol">بنزين</option><option value="diesel">ديزل</option><option value="electric">كهرباء</option><option value="other">أخرى</option></select></label></div><div class="row"><label>اللترات / الوحدة<input id="fuel-liters" type="number" min="0.01" step="0.01" required></label><label>سعر الوحدة<input id="fuel-price" type="number" min="0" step="0.001" value="0"></label><label>قراءة العداد<input id="fuel-odo" type="number" min="0" step="0.1"></label><label>المحطة<input id="fuel-vendor"></label><label>رقم الإيصال<input id="fuel-ref"></label><button class="btn teal" id="fuel-save">حفظ التعبئة</button></div></div></div>
      <div class="card noprint"><b>تسجيل صيانة أو إصلاح</b><div class="row"><label>المركبة<select id="maint-v">${vehicleOptions}</select></label><label>التاريخ<input type="date" id="maint-date" value="${today()}"></label><label>النوع<select id="maint-type"><option value="scheduled">دورية</option><option value="repair">إصلاح</option><option value="inspection">فحص</option><option value="tires">إطارات</option><option value="other">أخرى</option></select></label><label>الورشة<input id="maint-vendor"></label><label>قراءة العداد<input id="maint-odo" type="number" min="0" step="0.1"></label></div><div class="row"><label style="flex:2">وصف الأعمال<input id="maint-desc" required></label><label>التكلفة<input id="maint-cost" type="number" min="0" step="0.01" value="0"></label><label>موعد الصيانة القادم<input id="maint-next" type="date"></label><label>رقم الفاتورة<input id="maint-ref"></label><button class="btn teal" id="maint-save">حفظ الصيانة</button></div></div>` : ''}
      <div class="grid2"><div class="card"><b>آخر الرحلات</b>${table([{k:'trip_no',t:'رقم الرحلة'},{k:'trip_date',t:'التاريخ'},{k:'plate_no',t:'اللوحة'},{k:'driver_name',t:'السائق'},{k:'origin',t:'من'},{k:'destination',t:'إلى'},{k:'distance',t:'المسافة'},{k:'status',t:'الحالة'},{t:'إجراء',f:r=>can&&r.status==='planned'?`<button class="btn ghost sm" data-trip-complete="${r.id}">إنهاء الرحلة</button>`:''}],trips.slice(0,100))}</div><div class="card"><b>آخر عمليات الوقود</b>${table([{k:'fuel_date',t:'التاريخ'},{k:'plate_no',t:'اللوحة'},{k:'fuel_type',t:'النوع'},{k:'liters',t:'الكمية'},{k:'total_amount',t:'الإجمالي'},{k:'vendor',t:'المحطة'}],fuel.slice(0,100))}</div></div>
      <div class="card"><b>سجل الصيانة</b>${table([{k:'maintenance_date',t:'التاريخ'},{k:'plate_no',t:'اللوحة'},{k:'maintenance_type',t:'النوع'},{k:'description',t:'الأعمال'},{k:'vendor',t:'الورشة'},{k:'cost',t:'التكلفة'},{k:'next_due_date',t:'الموعد القادم'}],maintenance.slice(0,100))}</div>`;
    const renderVehicles = () => { const q=($('#fl-q')?.value||'').toLowerCase().trim(), status=$('#fl-status')?.value, branch=$('#fl-branch')?.value; const rows=vehicles.filter(v=>(!q||`${v.plate_no} ${v.make} ${v.model} ${v.vin||''}`.toLowerCase().includes(q))&&(!status||v.status===status)&&(!branch||String(v.branch_id)===branch)); $('#fl-vehicles').innerHTML=table([{k:'plate_no',t:'اللوحة'},{k:'make',t:'الصانع'},{k:'model',t:'الطراز'},{k:'model_year',t:'السنة'},{k:'vehicle_type',t:'الفئة'},{k:'branch_name',t:'الفرع'},{k:'driver_name',t:'المسؤول'},{k:'odometer',t:'العداد'},{k:'registration_expiry',t:'انتهاء الاستمارة'},{k:'insurance_expiry',t:'انتهاء التأمين'},{t:'الحالة',f:r=>statusLabel[r.status]||r.status},{t:'إجراءات',f:r=>can?`<button class="btn ghost sm" data-fl-status="${r.id}">تغيير الحالة</button>`:''}],rows); $('#fl-vehicles').querySelectorAll('[data-fl-status]').forEach(b=>b.onclick=guard(async()=>{const v=vehicles.find(x=>x.id===Number(b.dataset.flStatus));const states=['active','in_service','inactive'];const next=states[(states.indexOf(v.status)+1)%states.length];await api(`/fleet/vehicles/${v.id}`,{method:'PUT',body:{status:next}});toast('تم تحديث حالة المركبة');render();})); };
    m.querySelectorAll('[data-trip-complete]').forEach(b=>b.onclick=guard(async()=>{const end=prompt('أدخل قراءة العداد عند نهاية الرحلة');if(end===null||!end.trim())return;await api(`/fleet/trips/${b.dataset.tripComplete}`,{method:'PUT',body:{status:'completed',end_odometer:end}});toast('تم إنهاء الرحلة وتحديث عداد المركبة');render();}));
    renderVehicles(); $('#fl-q').oninput=renderVehicles; $('#fl-status').onchange=renderVehicles; $('#fl-branch').onchange=renderVehicles;
    $('#fl-pr').onclick=()=>printDoc('سجل مركبات الأسطول',table([{k:'plate_no',t:'اللوحة'},{k:'make',t:'الصانع'},{k:'model',t:'الطراز'},{k:'model_year',t:'السنة'},{k:'branch_name',t:'الفرع'},{k:'driver_name',t:'المسؤول'},{k:'odometer',t:'العداد'},{k:'registration_expiry',t:'الاستمارة'},{k:'insurance_expiry',t:'التأمين'},{k:'status',t:'الحالة'}],vehicles)); $('#fl-csv').onclick=()=>csv('fleet-vehicles',vehicles);
    if(can && $('#fl-save')) $('#fl-save').onclick=guard(async()=>{await api('/fleet/vehicles',{method:'POST',body:{plate_no:$('#fl-plate').value,vin:$('#fl-vin').value,make:$('#fl-make').value,model:$('#fl-model').value,model_year:$('#fl-year').value||null,vehicle_type:$('#fl-type').value,ownership:$('#fl-own').value,status:$('#fl-new-status').value,branch_id:$('#fl-new-branch').value||null,employee_id:$('#fl-driver').value||null,odometer:$('#fl-odo').value,registration_expiry:$('#fl-reg').value||null,insurance_expiry:$('#fl-ins').value||null,inspection_due:$('#fl-inspect').value||null,notes:$('#fl-notes').value}});toast('تمت إضافة المركبة');render();});
    if(can && $('#trip-save')) $('#trip-save').onclick=guard(async()=>{await api('/fleet/trips',{method:'POST',body:{vehicle_id:$('#trip-v').value,driver_id:$('#trip-d').value||null,trip_date:$('#trip-date').value,origin:$('#trip-from').value,destination:$('#trip-to').value,purpose:$('#trip-purpose').value,start_odometer:$('#trip-start').value,end_odometer:$('#trip-end').value||null,status:$('#trip-status').value}});toast('تم تسجيل الرحلة');render();});
    if(can && $('#fuel-save')) $('#fuel-save').onclick=guard(async()=>{await api('/fleet/fuel',{method:'POST',body:{vehicle_id:$('#fuel-v').value,fuel_date:$('#fuel-date').value,fuel_type:$('#fuel-type').value,liters:$('#fuel-liters').value,unit_price:$('#fuel-price').value,odometer:$('#fuel-odo').value||null,vendor:$('#fuel-vendor').value,reference:$('#fuel-ref').value}});toast('تم تسجيل تعبئة الوقود');render();});
    if(can && $('#maint-save')) $('#maint-save').onclick=guard(async()=>{await api('/fleet/maintenance',{method:'POST',body:{vehicle_id:$('#maint-v').value,maintenance_date:$('#maint-date').value,maintenance_type:$('#maint-type').value,vendor:$('#maint-vendor').value,odometer:$('#maint-odo').value||null,description:$('#maint-desc').value,cost:$('#maint-cost').value,next_due_date:$('#maint-next').value||null,reference:$('#maint-ref').value}});toast('تم تسجيل الصيانة');render();});
    done(m);
  },
  async payroll(m) {
    const [runs, br] = await Promise.all([api('/payroll/runs'), api('/branches')]);
    const can = ['admin', 'accountant'].includes(me.role);
    const PST = { draft: ['closed', 'مسودة'], approved: ['asset', 'معتمد'], posted: ['open', 'مرحّل'], paid: ['ok', 'مدفوع'] };
    m.innerHTML = head('مسيرات الرواتب الشهرية', 'إعداد مسيرات الرواتب، الاحتساب الآلي، الاعتماد الإداري، والترحيل المحاسبي المتوازن إلى دفتر الأستاذ العام.', '<button class="btn" id="pr-p-runs">🖨️ طباعة قائمة المسيرات</button>') +
      `<div class="kpi-grid"><div class="kpi"><span>إجمالي المسيرات</span><b>${runs.length}</b></div><div class="kpi"><span>المسيرات المعتمدة والمرحّلة</span><b>${runs.filter(r => ['approved','posted','paid'].includes(r.status)).length}</b></div><div class="kpi"><span>صافي الرواتب المصروفة</span><b>${money(runs.filter(r => ['posted','paid'].includes(r.status)).reduce((s, r) => s + Number(r.net_total||0), 0))} ر.س</b></div></div>
      <div class="card">${table([
        { k: 'run_no', t: 'رقم المسير' },
        { t: 'الفترة', f: r => `${r.year}/${String(r.month).padStart(2, '0')}` },
        { k: 'branch_name', t: 'الفرع' },
        { k: 'employees_count', t: 'الموظفون' },
        num('gross_total'),
        num('deductions_total'),
        num('net_total'),
        { t: 'الحالة', f: r => tag(...(PST[r.status] || ['closed', r.status])) },
        { t: 'القيد المحاسبي', f: r => jeLink(r.journal_entry_id) },
        { t: '', f: r => `<span class="noprint">
          <button class="btn sm ghost" data-view-run="${r.id}">التفاصيل</button>
          ${can && r.status === 'draft' ? `<button class="btn sm" data-appr-run="${r.id}">اعتماد</button>` : ''}
          ${can && r.status === 'approved' ? `<button class="btn sm teal" data-post-run="${r.id}">ترحيل محاسبي</button>` : ''}
          ${can && r.status === 'posted' ? `<button class="btn sm amber" data-pay-run="${r.id}">تسجيل الصرف</button>` : ''}
        </span>` }
      ], runs)}</div>
      <div id="run-detail"></div>
      ${can ? `<div class="card noprint"><b>إنشاء مسير رواتب جديد</b>
        <div class="row">
          <label>السنة<input type="number" id="p-yr" value="${new Date().getFullYear()}"></label>
          <label>الشهر<select id="p-mo">${Array.from({length: 12}, (_, i) => `<option value="${i+1}" ${i+1 === new Date().getMonth()+1 ? 'selected' : ''}>${i+1}</option>`).join('')}</select></label>
          <label>الفرع<select id="p-br"><option value="">كل الفروع</option>${br.map(b => `<option value="${b.id}">${esc(b.name_ar)}</option>`).join('')}</select></label>
          <label style="flex:2">ملاحظات المسير<input id="p-note" placeholder="مسير رواتب شهر..."></label>
          <button class="btn teal" id="p-create">إنشاء المسير الآلي</button>
        </div>
      </div>` : ''}`;

    $('#pr-p-runs').onclick = () => printDoc('سجل مسيرات الرواتب الشهرية', table([
      { k: 'run_no', t: 'رقم المسير' },
      { t: 'الفترة', f: r => `${r.year}/${String(r.month).padStart(2, '0')}` },
      { k: 'branch_name', t: 'الفرع' },
      { k: 'employees_count', t: 'الموظفون' },
      num('gross_total', 'إجمالي الرواتب'),
      num('deductions_total', 'الاستقطاعات'),
      num('net_total', 'الصافي')
    ], runs), { subtitle: 'سجل المسيرات الشهرية المعتمدة' });

    if (can) $('#p-create').onclick = guard(async () => {
      const r = await api('/payroll/runs', {
        method: 'POST',
        body: {
          year: $('#p-yr').value,
          month: $('#p-mo').value,
          branch_id: $('#p-br').value || undefined,
          notes: $('#p-note').value || undefined
        }
      });
      toast('تم إنشاء المسير رقم ' + r.run_no + ` (${r.items?.length || 0} موظف)`);
      render();
    });

    m.querySelectorAll('[data-view-run]').forEach(b => b.onclick = guard(async () => {
      const r = await api('/payroll/runs/' + b.dataset.viewRun);
      $('#run-detail').innerHTML = `<div class="card">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
          <b>تفاصيل مسير الرواتب: ${esc(r.run_no)} (${r.year}/${String(r.month).padStart(2, '0')})</b>
          <button class="btn sm noprint" id="pr-p-sheet">🖨️ طباعة مسير الرواتب (A4)</button>
        </div>
        <div id="pei-edit-box"></div>
        ${table([
          { k: 'employee_no', t: 'الرقم' },
          { k: 'name_ar', t: 'الموظف' },
          num('basic_salary', 'الأساسي'),
          num('housing_allowance', 'سكن'),
          num('transport_allowance', 'نقل'),
          num('other_allowances', 'أخرى'),
          num('gross_salary', 'الإجمالي'),
          num('gosi_deduction', 'تأمينات'),
          num('other_deductions', 'استقطاع'),
          num('net_salary', 'الصافي'),
          { t: 'الإجراءات', f: it => `<span class="noprint">
            <button class="btn ghost sm" data-slip="${it.id}">🖨️ قسيمة</button>
            ${can && r.status === 'draft' ? `<button class="btn ghost sm" data-pei="${it.id}">تعديل</button>` : ''}
          </span>` }
        ], r.items || [])}
      </div>`;

      $('#pr-p-sheet').onclick = () => {
        const pMeta = `
          <div class="p-meta-item"><span class="p-meta-label">رقم المسير:</span><span class="p-meta-val">${esc(r.run_no)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">فترة المسير:</span><span class="p-meta-val">${r.year} / شهر ${String(r.month).padStart(2, '0')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">الفرع:</span><span class="p-meta-val">${esc(r.branch_name || 'كل الفروع')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">عدد الموظفين:</span><span class="p-meta-val">${r.employees_count} موظف</span></div>
          <div class="p-meta-item"><span class="p-meta-label">إجمالي الصافي:</span><span class="p-meta-val">${money(r.net_total)} ر.س</span></div>
        `;
        const pSheetTable = table([
          { k: 'employee_no', t: 'الرقم' },
          { k: 'name_ar', t: 'الموظف' },
          num('basic_salary', 'الأساسي'),
          num('housing_allowance', 'سكن'),
          num('transport_allowance', 'نقل'),
          num('other_allowances', 'أخرى'),
          num('gross_salary', 'الإجمالي'),
          num('gosi_deduction', 'تأمينات'),
          num('other_deductions', 'استقطاع'),
          num('net_salary', 'الصافي'),
          { t: 'توقيع المستلم', f: () => '________________' }
        ], r.items || []);
        const pSheetTotals = `<table style="margin-top:10px"><tr class="tot">
          <td>إجمالي الرواتب الأساسية: ${money(r.gross_total)} ر.س</td>
          <td>إجمالي الاستقطاعات: ${money(r.deductions_total)} ر.س</td>
          <td style="color:#0d9488">صافي الرواتب المطلوب تحويلها: ${money(r.net_total)} ر.س</td>
        </tr></table>`;
        printDoc(`كشف مسير رواتب الموظفين (${r.run_no})`, pSheetTable + pSheetTotals, { ref: r.run_no, meta: pMeta, subtitle: `كشف رواتب شهر ${r.month} لسنة ${r.year}` });
      };

      m.querySelectorAll('[data-slip]').forEach(sb => sb.onclick = () => {
        const it = (r.items || []).find(x => x.id === +sb.dataset.slip); if (!it) return;
        const slipMeta = `
          <div class="p-meta-item"><span class="p-meta-label">الرقم الوظيفي:</span><span class="p-meta-val">${esc(it.employee_no)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">اسم الموظف:</span><span class="p-meta-val">${esc(it.name_ar)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">فترة الراتب:</span><span class="p-meta-val">${r.year} / شهر ${String(r.month).padStart(2, '0')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">الفرع / القسم:</span><span class="p-meta-val">${esc(r.branch_name || 'الرئيسي')}</span></div>
        `;
        const slipBody = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div>
              <h4 style="margin:0 0 8px;color:#0d9488">المستحقات والبدلات (Earnings)</h4>
              <table>
                <tr><td>الراتب الأساسي</td><td class="num">${money(it.basic_salary)}</td></tr>
                <tr><td>بدل السكن</td><td class="num">${money(it.housing_allowance)}</td></tr>
                <tr><td>بدل النقل</td><td class="num">${money(it.transport_allowance)}</td></tr>
                <tr><td>بدلات ومزايا أخرى</td><td class="num">${money(it.other_allowances)}</td></tr>
                <tr class="tot"><td>إجمالي الاستحقاق</td><td class="num">${money(it.gross_salary)}</td></tr>
              </table>
            </div>
            <div>
              <h4 style="margin:0 0 8px;color:#b91c1c">الخصومات والاستقطاعات (Deductions)</h4>
              <table>
                <tr><td>التأمينات الاجتماعية (GOSI)</td><td class="num">${money(it.gosi_deduction)}</td></tr>
                <tr><td>سلف / استقطاعات أخرى</td><td class="num">${money(it.other_deductions)}</td></tr>
                <tr class="tot"><td>إجمالي الاستقطاع</td><td class="num">${money(Number(it.gosi_deduction||0)+Number(it.other_deductions||0))}</td></tr>
              </table>
            </div>
          </div>
          <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:8px;padding:12px;margin:16px 0;text-align:center">
            <span style="font-size:12px;color:#166534">صافي الراتب المستحق للصرف (Net Salary)</span>
            <h2 style="margin:4px 0 0;color:#15803d;font-size:24px">${money(it.net_salary)} <small style="font-size:14px">ريال سعودي</small></h2>
          </div>
          <div class="p-meta">
            <div class="p-meta-item"><span class="p-meta-label">البنك المحول إليه:</span><span class="p-meta-val">${esc(it.bank_name || '—')}</span></div>
            <div class="p-meta-item"><span class="p-meta-label">رقم الحساب (IBAN):</span><span class="p-meta-val" dir="ltr">${esc(it.iban || '—')}</span></div>
          </div>
          <p style="font-size:11px;color:#64748b;margin-top:16px">إقرار: أقر أنا الموظف الموضح أعلاه بأنني استلمت كامل مستحقاتي ورواتبي عن هذا الشهر الموضح دون أي خصم أو تأخير.</p>
          <div style="display:flex;justify-content:space-between;margin-top:24px;border-top:1px dashed #cbd5e1;padding-top:12px">
            <div>توقيع الموظف المستلم: ___________________</div>
            <div>تاريخ الاستلام: ___________________</div>
          </div>
        `;
        printDoc(`قسيمة راتب الموظف (${it.name_ar})`, slipBody, { ref: r.run_no + '-' + it.employee_no, meta: slipMeta, subtitle: `قسيمة راتب شهر ${r.month}/${r.year}`, signatures: false });
      });

      m.querySelectorAll('[data-pei]').forEach(eb => eb.onclick = () => {
        const it = (r.items || []).find(x => x.id === +eb.dataset.pei); if (!it) return;
        $('#pei-edit-box').innerHTML = `<div class="card noprint"><b>تعديل استحقاق الموظف في هذا المسير: ${esc(it.name_ar)}</b>
          <div class="row">
            <label>الراتب الأساسي<input type="number" step="0.01" id="pei-sal" value="${it.basic_salary}"></label>
            <label>بدل سكن<input type="number" step="0.01" id="pei-house" value="${it.housing_allowance}"></label>
            <label>بدل نقل<input type="number" step="0.01" id="pei-trans" value="${it.transport_allowance}"></label>
            <label>بدلات أخرى<input type="number" step="0.01" id="pei-other" value="${it.other_allowances}"></label>
            <label>استقطاعات أخرى<input type="number" step="0.01" id="pei-ded" value="${it.other_deductions}"></label>
            <button class="btn teal" id="pei-save">حفظ</button>
            <button class="btn ghost" id="pei-cancel">إلغاء</button>
          </div></div>`;
        $('#pei-cancel').onclick = () => { $('#pei-edit-box').innerHTML = ''; };
        $('#pei-save').onclick = guard(async () => {
          await api(`/payroll/runs/${r.id}/items/${it.id}`, {
            method: 'PUT',
            body: {
              basic_salary: $('#pei-sal').value,
              housing_allowance: $('#pei-house').value,
              transport_allowance: $('#pei-trans').value,
              other_allowances: $('#pei-other').value,
              other_deductions: $('#pei-ded').value
            }
          });
          toast('تم تحديث بند الموظف'); b.click();
        });
        $('#pei-edit-box').scrollIntoView?.({ behavior: 'smooth' });
      });
    }));

    m.querySelectorAll('[data-appr-run]').forEach(b => b.onclick = guard(async () => {
      await api(`/payroll/runs/${b.dataset.apprRun}/approve`, { method: 'POST' });
      toast('تم اعتماد مسير الرواتب'); render();
    }));

    m.querySelectorAll('[data-post-run]').forEach(b => b.onclick = guard(async () => {
      if (!confirm('ترحيل قيد استحقاق مسير الرواتب إلى دفتر الأستاذ العام؟')) return;
      await api(`/payroll/runs/${b.dataset.postRun}/post`, { method: 'POST' });
      toast('تم ترحيل القيد المحاسبي بنجاح'); render();
    }));

    m.querySelectorAll('[data-pay-run]').forEach(b => b.onclick = guard(async () => {
      if (!confirm('تسجيل صرف المسير وإصدار قيد الصرف من البنك؟')) return;
      await api(`/payroll/runs/${b.dataset.payRun}/pay`, { method: 'POST', body: { bank_account: '1121' } });
      toast('تم تسجيل صرف الرواتب'); render();
    }));

    done(m);
  },
  async custody(m) {
    const [custodies, emps, tc] = await Promise.all([api('/custodies'), api('/employees'), api('/tax-codes')]);
    const can = ['admin', 'accountant'].includes(me.role);
    const CST = { draft: ['closed', 'مسودة'], disbursed: ['open', 'مصروفة / جارية'], partially_settled: ['asset', 'تسوية جزئية'], settled: ['ok', 'تمت التسوية'], closed: ['closed', 'مغلقة'] };
    const totalOut = custodies.reduce((s, c) => s + Number(c.balance || 0), 0);
    m.innerHTML = head('العهد النقدية للموظفين', 'صرف العهد التشغيلية، متابعة الأرصدة القائمة بذمة الموظفين (حساب 1170)، وتسوية الفواتير والمصروفات المؤيدة.', '<button class="btn" id="pr-cust-all">🖨️ طباعة كشف العهد</button>') +
      `<div class="kpi-grid"><div class="kpi"><span>إجمالي العهد المصروفة</span><b>${custodies.length}</b></div><div class="kpi"><span>العهد الجارية</span><b>${custodies.filter(c => ['disbursed','partially_settled'].includes(c.status)).length}</b></div><div class="kpi"><span>إجمالي الرصيد القائم (بذمة الموظفين)</span><b>${money(totalOut)} ر.س</b></div></div>
      <div id="cust-edit-box"></div>
      <div class="card">${table([
        { k: 'custody_no', t: 'رقم العهدة' },
        { k: 'employee_name', t: 'الموظف' },
        { k: 'branch_name', t: 'الفرع' },
        { t: 'تاريخ الصرف', f: r => r.disburse_date || r.created_at?.slice(0, 10) },
        num('amount'),
        num('spent_amount'),
        num('returned_amount'),
        num('balance'),
        { t: 'الحالة', f: r => tag(...(CST[r.status] || ['closed', r.status])) },
        { t: 'قيد الصرف', f: r => jeLink(r.journal_entry_id) },
        { t: 'الإجراءات', f: r => `<span class="noprint">
          <button class="btn ghost sm" data-pr-cust="${r.id}" title="طباعة سند صرف العهدة">🖨️ سند صرف</button>
          ${['settled','partially_settled'].includes(r.status) ? `<button class="btn ghost sm" data-pr-sett="${r.id}" title="طباعة سند التسوية">🖨️ سند تسوية</button>` : ''}
          ${can && r.status === 'draft' ? `<button class="btn ghost sm" data-ce="${r.id}">تعديل</button> <button class="btn sm teal" data-disb="${r.id}">صرف</button>` : ''}
          ${can && ['disbursed','partially_settled'].includes(r.status) ? `<button class="btn sm amber" data-settle-dlg="${r.id}" data-bal="${r.balance}">تسوية</button>` : ''}
        </span>` }
      ], custodies)}</div>
      <div id="cust-settle-box"></div>
      ${can ? `<div class="card noprint"><b>طلب / صرف عهدة جديدة</b>
        <div class="row">
          <label style="flex:2">الموظف المسؤول<select id="c-emp">${emps.map(e => `<option value="${e.id}">${esc(e.name_ar)} (${e.employee_no})</option>`).join('')}</select></label>
          <label>المبلغ المصروف<input type="number" step="0.01" id="c-amt" value="1000"></label>
          <label>حساب الصرف<select id="c-acct"><option value="1121">1121 البنك الأهلي</option><option value="1110">1110 الصندوق الرئيسي</option></select></label>
          <label style="flex:2">الغرض من العهدة<input id="c-memo" placeholder="عهدة مشتريات وضيافة فرع..."></label>
          <button class="btn teal" id="c-create">صرف العهدة</button>
        </div>
      </div>` : ''}`;

    $('#pr-cust-all').onclick = () => printDoc('سجل العهد النقدية للموظفين', table([
      { k: 'custody_no', t: 'رقم العهدة' },
      { k: 'employee_name', t: 'الموظف' },
      { k: 'branch_name', t: 'الفرع' },
      num('amount', 'المبلغ المصروف'),
      num('spent_amount', 'المصروف الفعلي'),
      num('returned_amount', 'المرتجع'),
      num('balance', 'الرصيد المتبقي')
    ], custodies), { subtitle: 'مطابقة أرصدة العهد النقدية القائمة (حساب 1170)' });

    if (can) {
      $('#c-create').onclick = guard(async () => {
        const c = await api('/custodies', {
          method: 'POST',
          body: {
            employee_id: $('#c-emp').value,
            amount: $('#c-amt').value,
            disburse_account: $('#c-acct').value,
            purpose: $('#c-memo').value
          }
        });
        await api(`/custodies/${c.id}/disburse`, { method: 'POST', body: { disburse_account: $('#c-acct').value } });
        toast('تم إنشاء وصرف العهدة ' + c.custody_no);
        render();
      });

      m.querySelectorAll('[data-ce]').forEach(b => b.onclick = () => {
        const c = custodies.find(x => x.id === +b.dataset.ce); if (!c) return;
        $('#cust-edit-box').innerHTML = `<div class="card noprint"><b>تعديل مسودة العهدة: ${esc(c.custody_no)}</b>
          <div class="row">
            <label>المبلغ المصروف<input type="number" step="0.01" id="ce-amt" value="${c.amount}"></label>
            <label>حساب الصرف<select id="ce-acct"><option value="1121">1121 البنك الأهلي</option><option value="1110">1110 الصندوق الرئيسي</option></select></label>
            <label style="flex:2">الغرض من العهدة<input id="ce-memo" value="${esc(c.purpose || '')}"></label>
            <button class="btn teal" id="ce-save">حفظ التعديلات</button>
            <button class="btn ghost" id="ce-cancel">إلغاء</button>
          </div></div>`;
        $('#ce-cancel').onclick = () => { $('#cust-edit-box').innerHTML = ''; };
        $('#ce-save').onclick = guard(async () => {
          await api('/custodies/' + c.id, {
            method: 'PUT',
            body: {
              amount: $('#ce-amt').value,
              disburse_account: $('#ce-acct').value,
              purpose: $('#ce-memo').value
            }
          });
          toast('تم تعديل العهدة'); render();
        });
        $('#cust-edit-box').scrollIntoView?.({ behavior: 'smooth' });
      });
    }

    m.querySelectorAll('[data-pr-cust]').forEach(b => b.onclick = () => {
      const c = custodies.find(x => x.id === +b.dataset.prCust); if (!c) return;
      const cMeta = `
        <div class="p-meta-item"><span class="p-meta-label">رقم سند الصرف:</span><span class="p-meta-val">${esc(c.custody_no)}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">الموظف المستلم:</span><span class="p-meta-val">${esc(c.employee_name)}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">تاريخ الصرف:</span><span class="p-meta-val">${esc(c.disburse_date || c.created_at?.slice(0, 10))}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">الفرع:</span><span class="p-meta-val">${esc(c.branch_name || 'المركز الرئيسي')}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">حساب الصرف:</span><span class="p-meta-val">${esc(c.disburse_account || '1121')}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">قيد الصرف:</span><span class="p-meta-val">#${esc(c.journal_entry_id || '—')}</span></div>
      `;
      const cBody = `
        <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:16px;margin:16px 0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <span style="font-size:12px;color:#64748b">الغرض من صرف العهدة:</span>
              <p style="margin:4px 0 0;font-size:14px;font-weight:bold">${esc(c.purpose || 'عهدة مشتريات ومصروفات تشغيلية مؤقتة')}</p>
            </div>
            <div style="text-align:left">
              <span style="font-size:12px;color:#64748b">المبلغ المصروف</span>
              <h2 style="margin:2px 0 0;color:#0d9488;font-size:24px">${money(c.amount)} <small style="font-size:13px">ر.س</small></h2>
            </div>
          </div>
        </div>
        <p style="font-size:11px;color:#475569;margin-top:20px">إقرار واستلام عهدة: أقر أنا الموظف الموضح أعلاه بأنني استلمت المبلغ المذكور أعلاه كعهدة نقدية في ذمتي وأتعهد بتسويتها وتقديم الفواتير المؤيدة للنظامي أو إعادة المتبقي فور انتهاء الغرض منها.</p>
        <div style="display:flex;justify-content:space-between;margin-top:28px;border-top:1px dashed #cbd5e1;padding-top:12px">
          <div>توقيع الموظف المستلم: ___________________</div>
          <div>توقيع أمين الصندوق / المحاسب: ___________________</div>
        </div>
      `;
      printDoc(`سند صرف عهدة مالية (${c.custody_no})`, cBody, { ref: c.custody_no, meta: cMeta, subtitle: 'سند صرف عهدة نقدية للموظف' });
    });

    m.querySelectorAll('[data-pr-sett]').forEach(b => b.onclick = () => {
      const c = custodies.find(x => x.id === +b.dataset.prSett); if (!c) return;
      const sMeta = `
        <div class="p-meta-item"><span class="p-meta-label">رقم العهدة:</span><span class="p-meta-val">${esc(c.custody_no)}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">الموظف المسؤول:</span><span class="p-meta-val">${esc(c.employee_name)}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">المبلغ المصروف أصلاً:</span><span class="p-meta-val">${money(c.amount)} ر.س</span></div>
        <div class="p-meta-item"><span class="p-meta-label">الحالة:</span><span class="p-meta-val">${c.status === 'settled' ? 'تمت التسوية بالكامل' : 'تسوية جزئية'}</span></div>
      `;
      const sBody = `
        <table>
          <thead><tr><th>بند التسوية</th><th class="num">المبلغ (ر.س)</th></tr></thead>
          <tbody>
            <tr><td>إجمالي المصروفات المنفذة المؤيدة بفواتير</td><td class="num">${money(c.spent_amount)}</td></tr>
            <tr><td>المبلغ النقدي المرتجع والمودع بالبنك/الصندوق</td><td class="num">${money(c.returned_amount)}</td></tr>
            <tr class="tot"><td>إجمالي التسوية المنفذة</td><td class="num">${money(Number(c.spent_amount||0)+Number(c.returned_amount||0))}</td></tr>
            <tr style="background:#fef2f2"><td>الرصيد المتبقي القائم بذمة الموظف</td><td class="num" style="color:#b91c1c;font-weight:bold">${money(c.balance)}</td></tr>
          </tbody>
        </table>
      `;
      printDoc(`سند تسوية عهدة مالية (${c.custody_no})`, sBody, { ref: c.custody_no, meta: sMeta, subtitle: 'سند تسوية الفواتير والمصروفات' });
    });

    m.querySelectorAll('[data-disb]').forEach(b => b.onclick = guard(async () => {
      await api(`/custodies/${b.dataset.disb}/disburse`, { method: 'POST' });
      toast('تم صرف العهدة'); render();
    }));

    m.querySelectorAll('[data-settle-dlg]').forEach(b => b.onclick = () => {
      const id = b.dataset.settleDlg;
      const bal = b.dataset.bal;
      $('#cust-settle-box').innerHTML = `<div class="card noprint"><b>تسوية العهدة (الرصيد المتبقي: ${money(bal)} ر.س)</b>
        <div class="row">
          <label>تاريخ التسوية<input type="date" id="s-dt" value="${today()}"></label>
          <label style="flex:2">بيان المصروف<input id="s-desc" placeholder="فواتير صيانة ونثريات..."></label>
          <label>حساب المصروف<select id="s-exp"><option value="5400">5400 مصروفات تشغيلية</option><option value="5300">5300 إيجار ومنافع</option><option value="5500">5500 صيانة ومهمات</option><option value="5600">5600 ضيافة ونثريات</option></select></label>
        </div>
        <div class="row">
          <label>قيمة الفواتير (بدون ضريبة)<input type="number" step="0.01" id="s-net" value="${bal}"></label>
          <label>الضريبة<select id="s-tc">${tc.map(t => `<option value="${t.code}">${esc(t.name_ar)}</option>`).join('')}</select></label>
          <label>المبلغ النقدي المرتجع للصندوق<input type="number" step="0.01" id="s-ret" value="0"></label>
          <label>حساب إيداع المرتجع<select id="s-ret-acct"><option value="1121">1121 البنك الأهلي</option><option value="1110">1110 الصندوق الرئيسي</option></select></label>
          <button class="btn teal" id="s-submit">اعتماد وترحيل التسوية</button>
        </div>
      </div>`;

      $('#s-submit').onclick = guard(async () => {
        const net = Number($('#s-net').value || 0);
        const vatRate = $('#s-tc').value === 'S15' ? 15 : 0;
        const vatAmt = Number((net * (vatRate / 100)).toFixed(2));
        const returned = Number($('#s-ret').value || 0);
        await api(`/custodies/${id}/settle`, {
          method: 'POST',
          body: {
            settle_date: $('#s-dt').value,
            lines: [{
              expense_account: $('#s-exp').value,
              description: $('#s-desc').value,
              amount: net,
              tax_code: $('#s-tc').value,
              vat_amount: vatAmt
            }],
            returned_amount: returned,
            returned_account: returned > 0 ? $('#s-ret-acct').value : undefined
          }
        });
        toast('تم ترحيل تسوية العهدة بنجاح');
        render();
      });
    });

    done(m);
  },
  async expenses(m) {
    const [claims, emps, br, tc] = await Promise.all([api('/expense-claims'), api('/employees'), api('/branches'), api('/tax-codes')]);
    const can = ['admin', 'accountant'].includes(me.role);
    const XST = { submitted: ['closed', 'قيد المراجعة'], approved: ['asset', 'معتمدة'], rejected: ['locked', 'مرفوضة'], posted: ['open', 'مرحّلة'], paid: ['ok', 'مدفوعة'] };
    m.innerHTML = head('مطالبات المصروفات واسترداد النفقات', 'دورة مطالبات الموظفين للمصروفات، اعتماد الإدارة، وإصدار قيود الاستحقاق والصرف مع احتساب ضريبة المدخلات 1150.', '<button class="btn" id="pr-exp-all">🖨️ طباعة كشف المطالبات</button>') +
      `<div class="kpi-grid"><div class="kpi"><span>إجمالي المطالبات</span><b>${claims.length}</b></div><div class="kpi"><span>بانتظار الاعتماد</span><b>${claims.filter(c => c.status === 'submitted').length}</b></div><div class="kpi"><span>إجمالي المصروفات المعتمدة</span><b>${money(claims.filter(c => ['approved','posted','paid'].includes(c.status)).reduce((s, c) => s + Number(c.total_amount||0), 0))} ر.س</b></div></div>
      <div id="exp-edit-box"></div>
      <div class="card">${table([
        { k: 'claim_no', t: 'رقم المطالبة' },
        { k: 'employee_name', t: 'الموظف' },
        { k: 'branch_name', t: 'الفرع' },
        { k: 'claim_date', t: 'التاريخ' },
        { k: 'category', t: 'التصنيف' },
        num('amount'),
        num('vat_amount'),
        num('total_amount'),
        { t: 'الحالة', f: r => tag(...(XST[r.status] || ['closed', r.status])) },
        { t: 'القيد المحاسبي', f: r => jeLink(r.journal_entry_id) },
        { t: 'الإجراءات', f: r => `<span class="noprint">
          <button class="btn ghost sm" data-pr-cl="${r.id}" title="سند المطالبة">🖨️ سند</button>
          ${can && r.status === 'submitted' ? `<button class="btn ghost sm" data-xe="${r.id}">تعديل</button> <button class="btn sm teal" data-appr-cl="${r.id}">اعتماد</button> <button class="btn sm coral" data-rej-cl="${r.id}">رفض</button>` : ''}
          ${can && r.status === 'approved' ? `<button class="btn sm teal" data-post-cl="${r.id}">ترحيل محاسبي</button>` : ''}
        </span>` }
      ], claims)}</div>
      ${can ? `<div class="card noprint"><b>تقديم مطالبة مصروفات جديدة</b>
        <div class="row">
          <label style="flex:2">الموظف<select id="x-emp">${emps.map(e => `<option value="${e.id}">${esc(e.name_ar)} (${e.employee_no})</option>`).join('')}</select></label>
          <label>الفرع<select id="x-br">${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label>
          <label>التاريخ<input type="date" id="x-dt" value="${today()}"></label>
          <label>التصنيف<select id="x-cat"><option value="travel">سفر وانتداب</option><option value="hospitality">ضيافة واستقبال</option><option value="supplies">مستلزمات ومهمات</option><option value="fuel">وقود ومواصلات</option><option value="maintenance">صيانة دورية</option><option value="other">أخرى</option></select></label>
        </div>
        <div class="row">
          <label style="flex:2">البيان / الوصف<input id="x-desc" placeholder="بيان المصروف والمستند المؤيد..."></label>
          <label>الحساب المدين<select id="x-acct"><option value="5400">5400 مصروفات تشغيلية</option><option value="5500">5500 صيانة ومهمات</option><option value="5600">5600 ضيافة ونثريات</option><option value="5300">5300 منافع وإيجار</option></select></label>
          <label>المبلغ قبل الضريبة<input type="number" step="0.01" id="x-amt" value="100"></label>
          <label>الضريبة<select id="x-tc">${tc.map(t => `<option value="${t.code}">${esc(t.name_ar)}</option>`).join('')}</select></label>
          <button class="btn teal" id="x-submit">تقديم المطالبة</button>
        </div>
      </div>` : ''}`;

    $('#pr-exp-all').onclick = () => printDoc('سجل مطالبات المصروفات', table([
      { k: 'claim_no', t: 'رقم المطالبة' },
      { k: 'employee_name', t: 'الموظف' },
      { k: 'branch_name', t: 'الفرع' },
      { k: 'category', t: 'التصنيف' },
      num('amount', 'المبلغ'),
      num('vat_amount', 'الضريبة'),
      num('total_amount', 'الإجمالي')
    ], claims), { subtitle: 'سجل مطالبات استرداد النفقات المعتمدة' });

    if (can) {
      $('#x-submit').onclick = guard(async () => {
        const amt = Number($('#x-amt').value || 0);
        const vatRate = $('#x-tc').value === 'S15' ? 15 : 0;
        const vatAmt = Number((amt * (vatRate / 100)).toFixed(2));
        await api('/expense-claims', {
          method: 'POST',
          body: {
            employee_id: $('#x-emp').value,
            branch: $('#x-br').value,
            claim_date: $('#x-dt').value,
            category: $('#x-cat').value,
            description: $('#x-desc').value,
            expense_account: $('#x-acct').value,
            amount: amt,
            tax_code: $('#x-tc').value,
            vat_amount: vatAmt,
            total_amount: amt + vatAmt
          }
        });
        toast('تم تقديم المطالبة بنجاح'); render();
      });

      m.querySelectorAll('[data-xe]').forEach(b => b.onclick = () => {
        const cl = claims.find(x => x.id === +b.dataset.xe); if (!cl) return;
        $('#exp-edit-box').innerHTML = `<div class="card noprint"><b>تعديل مطالبة المصروف: ${esc(cl.claim_no)}</b>
          <div class="row">
            <label style="flex:2">البيان / الوصف<input id="xe-desc" value="${esc(cl.description || '')}"></label>
            <label>المبلغ قبل الضريبة<input type="number" step="0.01" id="xe-amt" value="${cl.amount}"></label>
            <label>التصنيف<select id="xe-cat"><option value="travel" ${cl.category === 'travel' ? 'selected' : ''}>سفر وانتداب</option><option value="hospitality" ${cl.category === 'hospitality' ? 'selected' : ''}>ضيافة واستقبال</option><option value="supplies" ${cl.category === 'supplies' ? 'selected' : ''}>مستلزمات ومهمات</option><option value="fuel" ${cl.category === 'fuel' ? 'selected' : ''}>وقود ومواصلات</option><option value="maintenance" ${cl.category === 'maintenance' ? 'selected' : ''}>صيانة دورية</option><option value="other" ${cl.category === 'other' ? 'selected' : ''}>أخرى</option></select></label>
            <button class="btn teal" id="xe-save">حفظ التعديلات</button>
            <button class="btn ghost" id="xe-cancel">إلغاء</button>
          </div></div>`;
        $('#xe-cancel').onclick = () => { $('#exp-edit-box').innerHTML = ''; };
        $('#xe-save').onclick = guard(async () => {
          const amt = Number($('#xe-amt').value || 0);
          const vatRate = cl.tax_code === 'S15' ? 15 : 0;
          const vatAmt = Number((amt * (vatRate / 100)).toFixed(2));
          await api('/expense-claims/' + cl.id, {
            method: 'PUT',
            body: {
              description: $('#xe-desc').value,
              category: $('#xe-cat').value,
              amount: amt,
              vat_amount: vatAmt,
              total_amount: amt + vatAmt
            }
          });
          toast('تم تعديل المطالبة'); render();
        });
        $('#exp-edit-box').scrollIntoView?.({ behavior: 'smooth' });
      });
    }

    m.querySelectorAll('[data-pr-cl]').forEach(b => b.onclick = () => {
      const cl = claims.find(x => x.id === +b.dataset.prCl); if (!cl) return;
      const clMeta = `
        <div class="p-meta-item"><span class="p-meta-label">رقم المطالبة:</span><span class="p-meta-val">${esc(cl.claim_no)}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">الموظف:</span><span class="p-meta-val">${esc(cl.employee_name)}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">تاريخ المطالبة:</span><span class="p-meta-val">${esc(cl.claim_date)}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">الفرع:</span><span class="p-meta-val">${esc(cl.branch_name || 'المركز الرئيسي')}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">التصنيف:</span><span class="p-meta-val">${esc(cl.category)}</span></div>
        <div class="p-meta-item"><span class="p-meta-label">القيد المحاسبي:</span><span class="p-meta-val">#${esc(cl.journal_entry_id || '—')}</span></div>
      `;
      const clBody = `
        <table>
          <thead><tr><th>البيان والمصروف المؤيد</th><th>حساب المصروف</th><th class="num">المبلغ (بدون ضريبة)</th><th class="num">الضريبة</th><th class="num">الإجمالي شامل الضريبة</th></tr></thead>
          <tbody>
            <tr>
              <td>${esc(cl.description)}</td>
              <td>${esc(cl.expense_account)}</td>
              <td class="num">${money(cl.amount)}</td>
              <td class="num">${money(cl.vat_amount)}</td>
              <td class="num" style="font-weight:bold">${money(cl.total_amount)}</td>
            </tr>
          </tbody>
        </table>
        <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:10px;margin-top:12px;font-size:12px">
          <b>حالة المطالبة:</b> ${cl.status === 'approved' ? 'معتمدة إدارياً ومؤهلة للصرف' : cl.status === 'posted' ? 'مرحّلة محاسبياً في دفتر الأستاذ' : cl.status}
        </div>
      `;
      printDoc(`سند مطالبة واعتماد مصروفات (${cl.claim_no})`, clBody, { ref: cl.claim_no, meta: clMeta, subtitle: 'سند استرداد ومطالبة نفقات' });
    });

    m.querySelectorAll('[data-appr-cl]').forEach(b => b.onclick = guard(async () => {
      await api(`/expense-claims/${b.dataset.apprCl}/approve`, { method: 'POST' });
      toast('تم اعتماد المطالبة'); render();
    }));

    m.querySelectorAll('[data-rej-cl]').forEach(b => b.onclick = guard(async () => {
      const r = prompt('سبب الرفض:');
      if (!r) return;
      await api(`/expense-claims/${b.dataset.rejCl}/reject`, { method: 'POST', body: { reason: r } });
      toast('تم رفض المطالبة'); render();
    }));

    m.querySelectorAll('[data-post-cl]').forEach(b => b.onclick = guard(async () => {
      if (!confirm('ترحيل القيد المحاسبي للمطالبة؟')) return;
      await api(`/expense-claims/${b.dataset.postCl}/post`, { method: 'POST', body: { payment_account: '1121' } });
      toast('تم ترحيل قيد المصروف بنجاح'); render();
    }));

    done(m);
  },
  async hrrep(m) {
    const [pRep, cRep, xRep] = await Promise.all([
      api('/reports/hr/payroll-summary'),
      api('/reports/hr/custody-balances'),
      api('/reports/hr/expenses-by-category')
    ]);
    m.innerHTML = head('تقارير الموارد البشرية والعهد والمصروفات', 'تحليل تكاليف الرواتب الشهرية، مطابقة أرصدة العهد النقدية، وتصنيف المصروفات التشغيلية.') +
      `<div class="card">
        <div class="row" style="justify-content:space-between">
          <b>١) ملخص الرواتب والمسيرات الشهرية</b>
          <div><button class="btn sm noprint" id="pr-hr-p">🖨️ طباعة</button> <button class="btn ghost sm noprint" id="csv-p">تصدير CSV</button></div>
        </div>
        ${table([
          { t: 'الفترة', f: r => `${r.year}/${String(r.month).padStart(2, '0')}` },
          { k: 'branch_name', t: 'الفرع' },
          { k: 'runs_count', t: 'عدد المسيرات' },
          { k: 'total_employees', t: 'إجمالي الموظفين' },
          num('total_gross'),
          num('total_deductions'),
          num('total_net')
        ], pRep)}
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <b>٢) أرصدة العهد النقدية القائمة للموظفين (مطابقة حساب 1170)</b>
          <div><button class="btn sm noprint" id="pr-hr-c">🖨️ طباعة</button> <button class="btn ghost sm noprint" id="csv-c">تصدير CSV</button></div>
        </div>
        ${table([
          { k: 'employee_no', t: 'الرقم' },
          { k: 'name_ar', t: 'الموظف' },
          { k: 'branch_name', t: 'الفرع' },
          { k: 'custody_count', t: 'العهد' },
          num('total_disbursed'),
          num('total_spent'),
          num('total_returned'),
          num('current_balance')
        ], cRep)}
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <b>٣) كشف المصروفات والمطالبات حسب التصنيف والفرع</b>
          <div><button class="btn sm noprint" id="pr-hr-x">🖨️ طباعة</button> <button class="btn ghost sm noprint" id="csv-x">تصدير CSV</button></div>
        </div>
        ${table([
          { k: 'category', t: 'التصنيف' },
          { k: 'branch_name', t: 'الفرع' },
          { k: 'claims_count', t: 'عدد المطالبات' },
          num('net_amount'),
          num('vat_amount'),
          num('total_amount')
        ], xRep)}
      </div>
      <div class="card noprint filter-bar"><b>تقارير الأسطول</b><div class="row"><label>من تاريخ<input type="date" id="fr-from" value="${fiscalStart()}"></label><label>إلى تاريخ<input type="date" id="fr-to" value="${today()}"></label><label>المركبة<select id="fr-vehicle"><option value="">كل المركبات</option></select></label><label>الفرع<select id="fr-branch"><option value="">كل الفروع</option></select></label><label>التقرير<select id="fr-kind"><option value="trips">الرحلات والمسافات</option><option value="fuel">الوقود والتكاليف</option><option value="maintenance">الصيانة والإصلاحات</option></select></label><button class="btn teal" id="fr-go">تحديث التقرير</button><button class="btn ghost" id="fr-csv">تصدير CSV</button><button class="btn ghost" id="fr-print">طباعة</button></div></div>
      <div class="kpi-grid" id="fr-kpis"></div><div class="card" id="fr-out"></div>`;

    $('#pr-hr-p').onclick = () => printDoc('ملخص الرواتب والمسيرات الشهرية', table([
      { t: 'الفترة', f: r => `${r.year}/${String(r.month).padStart(2, '0')}` },
      { k: 'branch_name', t: 'الفرع' },
      { k: 'runs_count', t: 'عدد المسيرات' },
      { k: 'total_employees', t: 'إجمالي الموظفين' },
      num('total_gross'), num('total_deductions'), num('total_net')
    ], pRep), { subtitle: 'تقرير تحليلي لتكاليف الأجور' });

    $('#pr-hr-c').onclick = () => printDoc('أرصدة العهد النقدية القائمة (حساب 1170)', table([
      { k: 'employee_no', t: 'الرقم' },
      { k: 'name_ar', t: 'الموظف' },
      { k: 'branch_name', t: 'الفرع' },
      { k: 'custody_count', t: 'العهد' },
      num('total_disbursed'), num('total_spent'), num('total_returned'), num('current_balance')
    ], cRep), { subtitle: 'مطابقة أرصدة العهد بذمة الموظفين' });

    $('#pr-hr-x').onclick = () => printDoc('كشف المصروفات والمطالبات حسب التصنيف', table([
      { k: 'category', t: 'التصنيف' },
      { k: 'branch_name', t: 'الفرع' },
      { k: 'claims_count', t: 'عدد المطالبات' },
      num('net_amount'), num('vat_amount'), num('total_amount')
    ], xRep), { subtitle: 'تحليل المصروفات التشغيلية والضريبية' });

    $('#csv-p').onclick = () => csv('payroll-summary', pRep);
    $('#csv-c').onclick = () => csv('custody-balances', cRep);
    $('#csv-x').onclick = () => csv('expenses-by-category', xRep);
    const [fleetVehicles, fleetBranches] = await Promise.all([api('/fleet/vehicles'), api('/branches')]);
    $('#fr-vehicle').insertAdjacentHTML('beforeend', fleetVehicles.map(v=>`<option value="${v.id}">${esc(v.plate_no)} — ${esc(v.make)} ${esc(v.model)}</option>`).join(''));
    $('#fr-branch').insertAdjacentHTML('beforeend', fleetBranches.map(b=>`<option value="${b.id}">${esc(b.name_ar)}</option>`).join(''));
    let fleetRows=[]; const fleetCols={trips:[{k:'trip_no',t:'رقم الرحلة'},{k:'trip_date',t:'التاريخ'},{k:'plate_no',t:'اللوحة'},{k:'vehicle_name',t:'المركبة'},{k:'driver_name',t:'السائق'},{k:'origin',t:'من'},{k:'destination',t:'إلى'},{k:'purpose',t:'الغرض'},{k:'distance',t:'المسافة'}],fuel:[{k:'fuel_date',t:'التاريخ'},{k:'plate_no',t:'اللوحة'},{k:'vehicle_name',t:'المركبة'},{k:'fuel_type',t:'نوع الوقود'},{k:'liters',t:'الكمية'},{k:'unit_price',t:'سعر الوحدة'},{k:'total_amount',t:'الإجمالي'},{k:'odometer',t:'العداد'},{k:'vendor',t:'المحطة'}],maintenance:[{k:'maintenance_date',t:'التاريخ'},{k:'plate_no',t:'اللوحة'},{k:'vehicle_name',t:'المركبة'},{k:'maintenance_type',t:'النوع'},{k:'description',t:'الأعمال'},{k:'vendor',t:'الورشة'},{k:'cost',t:'التكلفة'},{k:'next_due_date',t:'الموعد القادم'}]};
    const fleetGo=guard(async()=>{const params=`from=${$('#fr-from').value}&to=${$('#fr-to').value}&vehicle_id=${$('#fr-vehicle').value}&branch_id=${$('#fr-branch').value}`;const kind=$('#fr-kind').value;const [s,r]=await Promise.all([api(`/reports/fleet/summary?${params}`),api(`/reports/fleet/${kind}?${params}`)]);fleetRows=r;$('#fr-kpis').innerHTML=`<div class="kpi"><span>المركبات النشطة</span><b>${s.active_vehicles}</b></div><div class="kpi"><span>الرحلات المكتملة</span><b>${s.trips}</b></div><div class="kpi"><span>المسافة المقطوعة</span><b>${money(s.distance)} كم</b></div><div class="kpi"><span>تكلفة الوقود</span><b>${money(s.fuel_cost)} ر.س</b></div><div class="kpi"><span>تكلفة الصيانة</span><b>${money(s.maintenance_cost)} ر.س</b></div>`;const titles={trips:'تقرير الرحلات والمسافات',fuel:'تقرير الوقود والتكاليف',maintenance:'تقرير الصيانة والإصلاحات'};$('#fr-out').innerHTML=`<h3>${titles[kind]}</h3>${table(fleetCols[kind],r)}`;});
    $('#fr-go').onclick=fleetGo; $('#fr-kind').onchange=fleetGo; $('#fr-csv').onclick=()=>fleetRows.length&&csv(`fleet-${$('#fr-kind').value}`,fleetRows); $('#fr-print').onclick=()=>printDoc(`تقرير الأسطول - ${$('#fr-kind').selectedOptions[0].text}`,$('#fr-out').innerHTML,{subtitle:`الفترة من ${$('#fr-from').value} إلى ${$('#fr-to').value}`}); fleetGo();
    done(m);
  }
};
const ctx = { icon, api, esc, money, today, head, foot, table, num, tag, guard, toast, $, done, csv, printDoc, getMe: () => me, getStores: () => stores, rerender: () => render(), go: v => { view = v; render(); },
  reloadStores: async () => { stores = await api('/stores'); }, token: () => token,
  getNav: () => NAV, ico, getCompany:()=>co, setCompany:value=>{co=value;}, getMenuState: () => ({ off: new Set(menuOff), locked: menuLocked, defaults: menuDefault }), hasFeature,
  applyMenu: async list => { const r = await api('/menu-settings', { method: 'PUT', body: { disabled: list } }); menuOff = new Set(r.disabled); } };
installCommerce(VIEWS, ctx);
installDashboard(VIEWS, ctx);   // يستبدل لوحة التحكم المبسّطة القديمة
async function boot() {
  try { const n = await (await fetch('/nav.json')).json(); NAV = n.mains; menuDefault = n.defaultDisabled || []; NAVI = n.icons || {}; } catch { NAV = []; }
  if (token) { try { stores = await api('/stores'); co = await api('/company'); const ms = await api('/menu-settings'); menuOff = new Set(ms.disabled); menuLocked = new Set(ms.locked); } catch {} }
  render();
  try { const h = await (await fetch('/api/health')).json(); if (h.version && h.version !== WEB_VERSION) toast(`الواجهة v${WEB_VERSION} لا تطابق الخادم v${h.version}`, false, 'استبدل مجلد web بالإصدار الجديد ثم اضغط Ctrl+F5'); } catch { /* health is best-effort */ }
}
boot();
window.addEventListener('focus', async () => {   // another admin may have changed إعدادات القوائم: apply it without a re-login (the current screen falls back to a visible one)
  if (!token) return;
  try { const ms = await api('/menu-settings'); if (JSON.stringify([...ms.disabled].sort()) !== JSON.stringify([...menuOff].sort())) { menuOff = new Set(ms.disabled); menuLocked = new Set(ms.locked); render(); } } catch {}
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

window.addEventListener('unhandledrejection', e => { if (token) toast('خطأ غير متوقع', false, String(e.reason?.message || e.reason)); });

