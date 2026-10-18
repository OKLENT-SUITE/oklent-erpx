// OKLENT-ERPX web client: no build step, no framework. Talks only to /api. https://oklent.net/
import { installCommerce } from './commerce.js';
import { icon } from './icons.js';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const money = v => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);   // Saudi business date (UTC+3), not the UTC date
const WEB_VERSION = '0.9.2';   // must equal the API version (/api/health); a mismatch means the browser/web folder is stale
let token = localStorage.getItem('erpx_token'), me = JSON.parse(localStorage.getItem('erpx_user') || 'null'), co = null, view = 'dashboard', data = {};

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: opts.body ? JSON.stringify(opts.body) : (opts.method && opts.method !== 'GET' ? '{}' : undefined) });
  if (r.status === 401 && path !== '/auth/login') { logout(); throw new Error('انتهت الجلسة'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error || r.statusText) + ' [' + r.status + ' ' + (opts.method || 'GET') + ' /api' + path + ']'); e.rule = j.rule; throw e; }
  return j;
}
function toast(msg, ok = true, sub = '') { const t = document.createElement('div'); t.className = 'toast ' + (ok ? 'ok' : 'err'); t.innerHTML = esc(msg) + (sub ? `<small>${esc(sub)}</small>` : ''); document.body.append(t); setTimeout(() => t.remove(), ok ? 3000 : 7000); }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.rule ? 'رفضت قاعدة قاعدة البيانات العملية' : 'خطأ', false, e.message); } };
const csv = (name, rows) => { const keys = Object.keys(rows[0] || {}); const body = [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + body + `\n"© 2026 OKLENT BUSINESS. جميع الحقوق محفوظة"\n`], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.csv'; a.click(); };

function logout() { localStorage.removeItem('erpx_token'); localStorage.removeItem('erpx_user'); token = null; me = null; render(); }
// Two-level navigation (spec: OKLENT-ERPX.xlsx "القوائم المقترحه للتحديث"). `need` hides an item unless some active store enables that feature.
let NAVI = {}; const ico = (id, size) => icon(NAVI[id], size);
let stores = [], NAV = [], menuOff = new Set(), menuLocked = new Set(), menuDefault = [];
// Navigation = web/nav.json (main menu > section > item). Visibility = settings (إعدادات القوائم) AND store features.
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
  if (vis.length && !vis.includes(view)) view = vis.includes('dashboard') ? 'dashboard' : vis[0];   // current screen was hidden in settings
  const cur = locate(view); if (cur.g) { openGroups.add(cur.g.id); if (cur.sc.t) openSecs.add(cur.sc.id); }
  const kidsHtml = sc => kidsOf(sc).map(([id, l]) => `<a data-v="${id}" class="${view === id ? 'on' : ''}">${ico(id, 15)}<span>${l}</span></a>`).join('');
  app.innerHTML = `<div class="mobtop"><button class="btn ghost sm" id="mb">☰</button><img src="/logo.png" alt="" width="26" height="26"><b>OKLENT-ERPX</b></div><div class="shell"><aside id="side">
   <div class="brand"><img src="/logo.png" alt="OKLENT" width="38" height="38">OKLENT-ERPX</div>
   ${NAV.filter(mainOk).map(g => { const open = openGroups.has(g.id), on = cur.g?.id === g.id;
     return `<div class="nav-g ${open ? 'open' : ''} ${on ? 'cur' : ''}"><button class="nav-h" data-g="${g.id}"><span class="ic">${ico('main:' + g.id, 20) || g.ic}</span><span>${g.t}</span><i class="chev">‹</i></button><div class="nav-k">` +
       g.secs.filter(secOk).map(sc => sc.t
         ? `<div class="nav-sec ${openSecs.has(sc.id) ? 'open' : ''} ${cur.sc?.id === sc.id ? 'cur' : ''}"><button class="nav-sh" data-s="${sc.id}">${ico('sec:' + sc.id, 17)}<span>${sc.t}</span><i class="chev">‹</i></button><div class="nav-sk">${kidsHtml(sc)}</div></div>`
         : `<div class="nav-flat">${kidsHtml(sc)}</div>`).join('') + '</div></div>'; }).join('')}
   <div class="nav-user">${esc(me?.username)} · ${esc(me?.role)}</div><a class="nav-out" id="lo">⏻ تسجيل الخروج</a><div class="nav-user"><span dir="ltr">© 2026 OKLENT BUSINESS.</span> جميع الحقوق محفوظة</div></aside><main id="main"></main></div>`;
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
  app.innerHTML = `<div class="login"><form class="box" id="lf"><img class="logo" src="/logo.png" alt="OKLENT"><h1>OKLENT-ERPX</h1><p>محرك محاسبي سعودي — قيد مزدوج · ZATCA · إدارة عقارات</p>
   <label>اسم المستخدم<input name="u" autocomplete="username" required></label><br><label>كلمة المرور<input name="p" type="password" autocomplete="current-password" required></label><br>
   <button class="btn teal" style="width:100%">دخول</button><div class="foot" style="border:0"><span dir="ltr">© 2026 OKLENT BUSINESS.</span> جميع الحقوق محفوظة</div></form></div>`;
  $('#lf').onsubmit = guard(async e => { e.preventDefault(); const f = new FormData(e.target);
    const r = await api('/auth/login', { method: 'POST', body: { username: f.get('u'), password: f.get('p') } });
    token = r.token; me = r.user; localStorage.setItem('erpx_token', token); localStorage.setItem('erpx_user', JSON.stringify(me)); boot(); });
}
const head = (t, s = '', actions = '') => `<div class="top"><div><h2>${ico(view, 24)}${t}</h2><div class="sub">${s}</div></div><div class="noprint">${actions}</div></div>
  <div class="printhead"><b>${esc(co?.name_ar)}</b> — ${t} — الرقم الضريبي <span class="n">${esc(co?.vat_number)}</span> — طُبع في <span class="n">${today()}</span></div>`;
const foot = () => `<div class="foot"><span dir="ltr">© 2026 OKLENT BUSINESS.</span> جميع الحقوق محفوظة · <span class="n" title="إصدار الواجهة">v${WEB_VERSION}</span></div>`;
const table = (cols, rows, opts = {}) => `<div class="scroll"><table><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${c.t}</th>`).join('')}</tr></thead><tbody>${rows.map(r =>
  `<tr class="${r._cls || ''}">${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="sub">لا توجد بيانات</td></tr>`}</tbody></table></div>`;
const num = k => ({ k, num: true, f: r => money(r[k]) });
const tag = (cls, t) => `<span class="tag t-${cls}">${esc(t)}</span>`;
const TYPES = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات' };
const done = main => { main.insertAdjacentHTML('beforeend', foot()); };

const VIEWS = {
  async dashboard(m) {
    co = co || await api('/company');
    const y = today().slice(0, 4);
    const [is, monthly, chain, inv, per] = await Promise.all([api(`/reports/income-statement?from=${y}-01-01&to=${today()}`), api(`/reports/monthly?from=${y}-01-01&to=${today()}`), api('/reports/chain-verify'), api('/invoices?limit=500'), api('/periods')]);
    const rev = is.filter(r => r.type === 'revenue').reduce((s, r) => s + +r.amount, 0), exp = is.filter(r => r.type === 'expense').reduce((s, r) => s + +r.amount, 0);
    const out = inv.filter(i => i.outstanding).reduce((s, i) => s + +i.outstanding, 0), mx = Math.max(1, ...monthly.flatMap(x => [+x.revenue, +x.expense]));
    m.innerHTML = head('لوحة التحكم', esc(co.name_ar)) + `<div class="kpis"><div class="kpi">الإيرادات<b class="n">${money(rev)}</b></div><div class="kpi">المصروفات<b class="n">${money(exp)}</b></div>
     <div class="kpi">صافي الربح<b class="n">${money(rev - exp)}</b></div><div class="kpi">ذمم مستحقة<b class="n">${money(out)}</b></div></div>
     <div class="grid2"><div class="card"><b>الإيرادات مقابل المصروفات شهرياً</b><div class="bars">${monthly.map(x => `<div class="g"><div class="pair"><i class="r" style="height:${+x.revenue / mx * 130}px" title="${x.revenue}"></i><i class="e" style="height:${+x.expense / mx * 130}px" title="${x.expense}"></i></div><span class="sub n">${x.month}</span></div>`).join('') || '<span class="sub">لا بيانات</span>'}</div>
       <span class="tag t-open">إيرادات</span> <span class="tag t-closed">مصروفات</span></div>
     <div class="card"><b>سلامة الدفتر</b><p>${chain.ok ? tag('ok', 'سلسلة التجزئة سليمة') : tag('bad', 'كُسرت السلسلة عند ' + chain.first_bad_entry)} <span class="sub">${chain.entries} قيد</span></p>
       <b>الفترات</b><p>${per.map(p => tag(p.status, p.name)).slice(0, 14).join(' ')}</p></div></div>`; done(m);
  },
  async accounts(m) {
    const a = await api('/accounts');
    m.innerHTML = head('دليل الحسابات السعودي', '1 أصول · 2 خصوم · 3 حقوق ملكية · 4 إيرادات · 5 مصروفات', '<button class="btn ghost" id="x">CSV</button>') +
      `<div class="card">${table([{ t: 'الرمز', f: r => `<b class="n">${r.code}</b>` }, { t: 'الاسم', f: r => `<span style="padding-inline-start:${(r.code.replace(/0+$/, '').length - 1) * 14}px">${r.is_postable ? '' : '<b>'}${esc(r.name_ar)}${r.is_postable ? '' : '</b>'}</span>` }, { k: 'name_en', t: 'English' }, { t: 'النوع', f: r => tag(r.type, TYPES[r.type]) }, { t: 'ترحيل', f: r => r.is_postable ? '✓' : 'رئيسي' }], a)}</div>`;
    $('#x').onclick = () => csv('chart-of-accounts', a.map(r => ({ code: r.code, name_ar: r.name_ar, name_en: r.name_en, type: r.type }))); done(m);
  },
  async journal(m) {
    const [list, acc, br] = await Promise.all([api('/journal?limit=100'), api('/accounts'), api('/branches')]);
    const post = acc.filter(a => a.is_postable); const opt = post.map(a => `<option value="${a.code}">${a.code} ${esc(a.name_ar)}</option>`).join('');
    m.innerHTML = head('قيود اليومية', 'قيد مزدوج — لا تعديل ولا حذف، التصحيح بقيد عكسي') + `<div class="card noprint"><b>قيد جديد</b><div class="row"><label>التاريخ<input type="date" id="jd" value="${today()}"></label><label>الفرع<select id="jb"><option value="">—</option>${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label><label style="flex:3">البيان<input id="jm"></label></div>
      <div id="jl"></div><div class="row"><button class="btn ghost" id="add">+ سطر</button><button class="btn teal" id="save">ترحيل القيد</button><span id="bal" class="tag t-open n"></span></div></div>
      <div class="card">${table([{ t: 'الرقم', f: r => `<a href="#" data-e="${r.id}" class="n">${r.entry_no}</a>` }, { k: 'entry_date', t: 'التاريخ' }, { k: 'memo', t: 'البيان' }, { k: 'source_type', t: 'المصدر' }, num('total_base'), { t: '', f: r => r.reversal_of ? tag('closed', 'عكسي') : '' }], list)}</div><div id="detail"></div>`;
    const lines = $('#jl'); const addLine = () => lines.insertAdjacentHTML('beforeend', `<div class="row ln"><label style="flex:3">الحساب<select>${opt}</select></label><label>مدين<input type="number" step="0.01" min="0" class="d"></label><label>دائن<input type="number" step="0.01" min="0" class="c"></label><label>عملة<select class="cu"><option>SAR</option><option>USD</option><option>EUR</option><option>AED</option></select></label></div>`);
    addLine(); addLine(); $('#add').onclick = addLine;
    const bal = () => { let d = 0, c = 0; lines.querySelectorAll('.ln').forEach(l => { d += +l.querySelector('.d').value || 0; c += +l.querySelector('.c').value || 0; }); $('#bal').textContent = `مدين ${d.toFixed(2)} | دائن ${c.toFixed(2)} (بعملة السطر)`; };
    lines.oninput = bal;
    $('#save').onclick = guard(async () => { const ls = [...lines.querySelectorAll('.ln')].map(l => ({ account: l.querySelector('select').value, debit: l.querySelector('.d').value || 0, credit: l.querySelector('.c').value || 0, currency: l.querySelector('.cu').value })).filter(l => +l.debit || +l.credit);
      const r = await api('/journal', { method: 'POST', body: { date: $('#jd').value, memo: $('#jm').value, branch: $('#jb').value || undefined, lines: ls } }); toast('تم الترحيل #' + r.id); render(); });
    m.querySelectorAll('[data-e]').forEach(a => a.onclick = guard(async e => { e.preventDefault(); const j = await api('/journal/' + a.dataset.e);
      $('#detail').innerHTML = `<div class="card"><b>${j.entry_no}</b> — ${esc(j.memo)} <span class="sub n">hash ${j.row_hash.slice(0, 16)}… ← ${j.prev_hash.slice(0, 16)}…</span>${table([{ k: 'code', t: 'الحساب' }, { k: 'name_ar', t: 'الاسم' }, { k: 'partner', t: 'الطرف' }, { k: 'currency_code', t: 'عملة' }, num('rate'), num('debit'), num('credit')], j.lines)}
       ${j.reversed_by || j.reversal_of ? '' : '<button class="btn coral sm noprint" id="rv">عكس القيد</button>'}</div>`;
      const rv = $('#rv'); if (rv) rv.onclick = guard(async () => { if (!confirm('سيُنشأ قيد عكسي بتاريخ اليوم. متابعة؟')) return; await api(`/journal/${j.id}/reverse`, { method: 'POST', body: { date: today() } }); toast('تم العكس'); render(); }); })); done(m);
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
      daybook: ['دفتر اليومية', [{ k: 'entry_date', t: 'التاريخ' }, { k: 'entry_no', t: 'القيد' }, { k: 'memo', t: 'البيان' }, { k: 'account_code', t: 'الحساب' }, { k: 'account_name', t: 'الاسم' }, num('debit'), num('credit')], true],
      'vat-return': ['ملخص إقرار ضريبة القيمة المضافة', [{ k: 'box', t: 'الخانة' }, { k: 'label_ar', t: 'البند' }, num('net'), num('vat')], true],
      'ar-aging': ['أعمار الذمم المدينة', [{ k: 'partner', t: 'العميل' }, { k: 'invoice_no', t: 'الفاتورة' }, { k: 'due_date', t: 'الاستحقاق' }, num('outstanding'), { k: 'bucket', t: 'الفئة' }], false] };
    m.innerHTML = head('التقارير المالية', 'تُحسب داخل قاعدة البيانات — A4 جاهزة للطباعة', '<button class="btn" id="pr">طباعة / PDF</button> <button class="btn ghost" id="cv">CSV</button>') +
      `<div class="card noprint"><div class="row"><label>التقرير<select id="rk">${Object.entries(R).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label><label>من<input type="date" id="rf" value="${today().slice(0, 4)}-01-01"></label><label>إلى<input type="date" id="rt" value="${today()}"></label>
      <label id="ra" style="display:none">الحساب<select id="rac">${acc.filter(a => a.is_postable).map(a => `<option value="${a.code}">${a.code} ${esc(a.name_ar)}</option>`).join('')}</select></label><button class="btn teal" id="go">عرض</button></div></div><div class="card" id="out"></div>`;
    let rows = [];
    const go = guard(async () => { const k = $('#rk').value; $('#ra').style.display = k === 'general-ledger' ? '' : 'none';
      rows = await api(`/reports/${k}?from=${$('#rf').value}&to=${$('#rt').value}&account=${$('#rac').value}`); const [t, cols, sum] = R[k]; let body = rows.map(r => ({ ...r }));
      let extra = '';
      if (k === 'income-statement') { const rv = rows.filter(r => r.type === 'revenue').reduce((s, r) => s + +r.amount, 0), ex = rows.filter(r => r.type === 'expense').reduce((s, r) => s + +r.amount, 0); extra = `<tr class="tot"><td colspan="3">صافي الربح (الخسارة)</td><td class="num">${money(rv - ex)}</td></tr>`; }
      if (k === 'balance-sheet') { const A = rows.filter(r => r.section === 'asset').reduce((s, r) => s + +r.amount, 0), LE = rows.filter(r => r.section !== 'asset').reduce((s, r) => s + +r.amount, 0); extra = `<tr class="tot"><td colspan="3">إجمالي الأصول</td><td class="num">${money(A)}</td></tr><tr class="tot"><td colspan="3">إجمالي الخصوم وحقوق الملكية</td><td class="num">${money(LE)}</td></tr><tr class="tot"><td colspan="3">الفرق (يجب 0.00)</td><td class="num">${money(A - LE)}</td></tr>`; }
      if (k === 'trial-balance') { const d = rows.reduce((s, r) => s + +r.closing_debit, 0), c = rows.reduce((s, r) => s + +r.closing_credit, 0); extra = `<tr class="tot"><td colspan="5">الإجمالي</td><td class="num">${money(d)}</td><td class="num">${money(c)}</td></tr>`; }
      const tb = table(cols, body); $('#out').innerHTML = `<div class="printhead" style="display:block"><b>${t}</b> ${$('#rf').value} → ${$('#rt').value}</div><h3 style="margin-top:0">${t}</h3>` + tb.replace('</tbody>', extra + '</tbody>'); });
    $('#go').onclick = go; $('#rk').onchange = go; $('#pr').onclick = () => print(); $('#cv').onclick = () => rows.length && csv($('#rk').value, rows); go(); done(m);
  },
  async properties(m) {
    const [p, u, br] = await Promise.all([api('/properties'), api('/units'), api('/branches')]); const can = ['admin', 'accountant'].includes(me.role);
    m.innerHTML = head('العقارات والوحدات', 'العقار التجاري: ضريبة 15% · السكني: معفى من الضريبة') + `<div class="card">${table([{ k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'العقار' }, { t: 'النوع', f: r => r.kind === 'commercial' ? tag('liability', 'تجاري') : tag('asset', 'سكني') }, { k: 'city', t: 'المدينة' }, { k: 'units', t: 'وحدات' }], p)}</div>
     <div class="card">${table([{ k: 'property', t: 'العقار' }, { k: 'unit_no', t: 'الوحدة' }, { k: 'kind', t: 'النوع' }, { k: 'area_m2', t: 'المساحة' }, num('base_annual_rent'), { t: 'الحالة', f: r => r.active_lease ? tag('closed', 'مؤجرة') : tag('open', 'شاغرة') }], u)}</div>
     ${can ? `<div class="card noprint"><b>إضافة عقار</b><div class="row"><label>الرمز<input id="pc"></label><label>الاسم<input id="pn"></label><label>النوع<select id="pk"><option value="commercial">تجاري</option><option value="residential">سكني</option></select></label><label>المدينة<input id="pt"></label><label>الفرع<select id="pb">${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label><button class="btn teal" id="pa">إضافة</button></div>
     <b>إضافة وحدة</b><div class="row"><label>العقار<select id="up">${p.map(x => `<option value="${x.id}">${esc(x.name_ar)}</option>`).join('')}</select></label><label>رقم الوحدة<input id="un"></label><label>المساحة م²<input id="ua" type="number"></label><label>الإيجار السنوي<input id="ur" type="number"></label><button class="btn teal" id="ua2">إضافة</button></div></div>` : ''}`;
    if (can) { $('#pa').onclick = guard(async () => { await api('/properties', { method: 'POST', body: { code: $('#pc').value, name_ar: $('#pn').value, kind: $('#pk').value, city: $('#pt').value, branch: $('#pb').value } }); render(); });
      $('#ua2').onclick = guard(async () => { await api('/units', { method: 'POST', body: { property_id: $('#up').value, unit_no: $('#un').value, area_m2: $('#ua').value || null, base_annual_rent: $('#ur').value || null } }); render(); }); } done(m);
  },
  async leases(m) {
    const [l, u, t] = await Promise.all([api('/leases'), api('/units'), api('/partners?kind=tenant')]); const can = ['admin', 'accountant'].includes(me.role);
    m.innerHTML = head('عقود الإيجار وجداول الأقساط') + `<div class="card">${table([{ k: 'number', t: 'العقد' }, { k: 'property', t: 'العقار' }, { k: 'unit_no', t: 'الوحدة' }, { k: 'tenant', t: 'المستأجر' }, { k: 'start_date', t: 'من' }, { k: 'end_date', t: 'إلى' }, num('annual_rent'), { t: 'الأقساط', f: r => `${r.billed}/${r.installments}` }, { t: '', f: r => `<button class="btn sm" data-s="${r.id}">الجدول</button>` }], l)}</div><div id="sch"></div>
     ${can ? `<div class="card noprint"><b>عقد جديد (يُنشأ الجدول تلقائياً)</b><div class="row"><label>الوحدة<select id="lu">${u.map(x => `<option value="${x.id}">${esc(x.property)} / ${esc(x.unit_no)}</option>`).join('')}</select></label><label>المستأجر<select id="lt">${t.map(x => `<option value="${x.id}">${esc(x.name_ar)}</option>`).join('')}</select></label><label>من<input type="date" id="ls"></label><label>إلى<input type="date" id="le"></label><label>الإيجار السنوي<input id="la" type="number"></label><label>الدفع<select id="lf"><option value="monthly">شهري</option><option value="quarterly">ربع سنوي</option><option value="semiannual">نصف سنوي</option><option value="annual">سنوي</option></select></label><button class="btn teal" id="lc">إنشاء</button></div></div>` : ''}`;
    if (can) $('#lc').onclick = guard(async () => { await api('/leases', { method: 'POST', body: { unit_id: $('#lu').value, tenant_id: $('#lt').value, start_date: $('#ls').value, end_date: $('#le').value, annual_rent: $('#la').value, payment_freq: $('#lf').value } }); toast('تم إنشاء العقد والجدول'); render(); });
    m.querySelectorAll('[data-s]').forEach(b => b.onclick = guard(async () => { const s = await api(`/leases/${b.dataset.s}/schedule`);
      $('#sch').innerHTML = `<div class="card">${table([{ k: 'seq', t: '#' }, { k: 'due_date', t: 'الاستحقاق' }, num('amount'), { k: 'vat_rate', t: '% ضريبة' }, { t: 'الفاتورة', f: r => r.invoice_no ? esc(r.invoice_no) : (can ? `<button class="btn amber sm" data-i="${r.id}">إصدار فاتورة</button>` : '—') }, num('outstanding')], s)}</div>`;
      $('#sch').querySelectorAll('[data-i]').forEach(x => x.onclick = guard(async () => { const r = await api(`/rent-schedule/${x.dataset.i}/invoice`, { method: 'POST' }); toast('صدرت الفاتورة ' + r.number); b.click(); })); })); done(m);
  },
  async invoices(m) {
    const [inv, pt, br, tc] = await Promise.all([api('/invoices'), api('/partners'), api('/branches'), api('/tax-codes')]); const can = ['admin', 'accountant', 'cashier'].includes(me.role);
    const K = { standard: 'ضريبية', simplified: 'مبسطة', credit: 'إشعار دائن', debit: 'إشعار مدين' };
    m.innerHTML = head('الفواتير الإلكترونية', 'شاشة التشغيل: إصدار وطباعة وقبض وإشعار دائن · ICV تسلسلي بلا فجوات · PIH · QR · لا تعديل — الإلغاء بإشعار دائن (للتحليل والتجميع استخدم «التقارير ← تقارير المبيعات»)') + `<div class="card">${table([{ k: 'number', t: 'الرقم' }, { t: 'النوع', f: r => K[r.kind] }, { k: 'partner', t: 'العميل' }, { t: 'التاريخ', f: r => r.issue_at.slice(0, 10) }, num('subtotal'), num('vat_amount'), num('total'), num('outstanding'), { k: 'icv', t: 'ICV' },
      { t: '', f: r => `<span class="noprint"><button class="btn sm" data-p="${r.id}">طباعة</button> <button class="btn ghost sm" data-x="${r.id}">XML</button> ${r.kind !== 'credit' && +r.outstanding > 0 && can ? `<button class="btn teal sm" data-pay="${r.id}" data-o="${r.outstanding}">قبض</button>` : ''} ${r.kind !== 'credit' && ['admin', 'accountant'].includes(me.role) ? `<button class="btn coral sm" data-cn="${r.id}">إشعار دائن</button>` : ''}</span>` }], inv)}</div>
     ${can ? `<div class="card noprint"><b>فاتورة جديدة</b><div class="row"><label>النوع<select id="ik"><option value="standard">ضريبية (B2B)</option><option value="simplified">مبسطة (B2C)</option></select></label><label>العميل<select id="ic"><option value="">— نقدي —</option>${pt.map(x => `<option value="${x.id}">${esc(x.name_ar)}</option>`).join('')}</select></label><label>الفرع<select id="ib">${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label></div>
      <div class="row"><label style="flex:3">الوصف<input id="id"></label><label>الكمية<input id="iq" type="number" value="1"></label><label>السعر<input id="ip" type="number" step="0.01"></label><label>الضريبة<select id="it">${tc.map(x => `<option value="${x.code}">${esc(x.name_ar)}</option>`).join('')}</select></label><label>الإيراد<select id="ia"><option value="4200">مبيعات الألعاب</option><option value="4300">الصيانة وما بعد البيع</option><option value="4100">الإيجار</option><option value="4900">أخرى</option></select></label><button class="btn teal" id="ig">إصدار</button></div></div>` : ''}`;
    if (can) $('#ig').onclick = guard(async () => { const r = await api('/invoices', { method: 'POST', body: { kind: $('#ik').value, partner_id: $('#ic').value || undefined, branch: $('#ib').value, lines: [{ description: $('#id').value, qty: $('#iq').value, unit_price: $('#ip').value, tax_code: $('#it').value, revenue_account: $('#ia').value }] } }); toast('صدرت ' + r.number); render(); });
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = guard(async () => { const r = await fetch(`/api/invoices/${b.dataset.p}/print`, { headers: { authorization: 'Bearer ' + token } }); const w = open('', '_blank'); w.document.write(await r.text()); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 400); }));
    m.querySelectorAll('[data-x]').forEach(b => b.onclick = guard(async () => { const r = await fetch(`/api/invoices/${b.dataset.x}/xml`, { headers: { authorization: 'Bearer ' + token } }); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'invoice-' + b.dataset.x + '.xml'; a.click(); }));
    m.querySelectorAll('[data-pay]').forEach(b => b.onclick = guard(async () => { const a = prompt('مبلغ القبض (المتبقي ' + b.dataset.o + '):', b.dataset.o); if (!a) return; await api(`/invoices/${b.dataset.pay}/payments`, { method: 'POST', body: { amount: a, cash_account: '1121', method: 'bank' } }); toast('تم القبض'); render(); }));
    m.querySelectorAll('[data-cn]').forEach(b => b.onclick = guard(async () => { const r = prompt('سبب إشعار الدائن (إلزامي):'); if (!r) return; const x = await api('/invoices', { method: 'POST', body: { kind: 'credit', related_invoice_id: b.dataset.cn, reason: r } }); toast('صدر ' + x.number); render(); })); done(m);
  },
  async partners(m) {
    const p = await api('/partners'); const can = ['admin', 'accountant', 'cashier'].includes(me.role);
    m.innerHTML = head('العملاء والمستأجرون والموردون') + `<div class="card">${table([{ k: 'name_ar', t: 'الاسم' }, { k: 'kind', t: 'النوع' }, { k: 'vat_number', t: 'الرقم الضريبي' }, { k: 'cr_number', t: 'السجل التجاري' }, { k: 'city', t: 'المدينة' }, { k: 'phone', t: 'الجوال' }], p)}</div>
     ${can ? `<div class="card noprint"><b>إضافة</b><div class="row"><label>النوع<select id="qk"><option value="customer">عميل</option><option value="tenant">مستأجر</option><option value="vendor">مورد</option></select></label><label>الاسم<input id="qn"></label><label>الرقم الضريبي (15 رقم، يبدأ وينتهي بـ 3)<input id="qv" maxlength="15"></label><label>المدينة<input id="qc"></label><button class="btn teal" id="qs">حفظ</button></div></div>` : ''}`;
    if (can) $('#qs').onclick = guard(async () => { await api('/partners', { method: 'POST', body: { kind: $('#qk').value, name_ar: $('#qn').value, vat_number: $('#qv').value, city: $('#qc').value } }); render(); }); done(m);
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
  }
};
const ctx = { api, esc, money, today, head, foot, table, num, tag, guard, toast, $, done, csv, getMe: () => me, getStores: () => stores, rerender: () => render(),
  reloadStores: async () => { stores = await api('/stores'); }, token: () => token,
  getNav: () => NAV, ico, getMenuState: () => ({ off: new Set(menuOff), locked: menuLocked, defaults: menuDefault }), hasFeature,
  applyMenu: async list => { const r = await api('/menu-settings', { method: 'PUT', body: { disabled: list } }); menuOff = new Set(r.disabled); } };
installCommerce(VIEWS, ctx);
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
