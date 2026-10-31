// لوحة التحكم التنفيذية الديناميكية — OKLENT BUSINESS 1.2.0
// كل الأرقام تأتي من واجهات API الموجودة (للقراءة فقط)؛ لا حساب مالي هنا إلا تجميع/عرض.
// أي مصدر يفشل (صلاحية/شبكة) يُخفي لوحته فقط ولا يكسر الشاشة. الرسوم SVG/CSS بلا مكتبات خارجية.
export function installDashboard(VIEWS, X) {
  const { api, esc, money, today, head, done, $ } = X;
  const N = v => Number(v) || 0;
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const n0 = v => Math.round(N(v)).toLocaleString('en-US');
  const C = { teal: '#14B8A6', violet: '#8B5CF6', amber: '#F59E0B', blue: '#3B82F6', coral: '#F43F5E', sky: '#0EA5E9', green: '#22C55E', slate: '#94A3B8' };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
  const S = { period: ls.get('dash_period') || 'month', kind: 'all', theme: ls.get('dash_theme') || 'dk', auto: ls.get('dash_auto') !== '0' };
  const PERIODS = [['month', 'الشهر الحالي'], ['quarter', 'الربع'], ['year', 'السنة'], ['last30', 'آخر 30 يوماً'], ['all', 'الكل']];
  const KINDS = [['all', 'كل الأنواع'], ['standard', 'ضريبية'], ['simplified', 'مبسطة'], ['credit', 'إشعار دائن'], ['debit', 'إشعار مدين']];
  const KL = { standard: 'ضريبية', simplified: 'مبسطة', credit: 'إشعار دائن', debit: 'إشعار مدين' };
  const BK = { new: 'جديد', confirmed: 'مؤكد', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغي' };
  const OR = { new: 'جديد', confirmed: 'مؤكد', fulfilled: 'منفّذ', cancelled: 'ملغي' };
  const ES = { active: 'على رأس العمل', suspended: 'موقوف', terminated: 'منتهي الخدمة' };

  // ---------- dates ----------
  const ymd = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
  const rangeOf = p => { const t = today(), y = t.slice(0, 4), m = +t.slice(5, 7), pad = x => String(x).padStart(2, '0');
    if (p === 'month') return { from: `${y}-${pad(m)}-01`, to: t };
    if (p === 'quarter') return { from: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: t };
    if (p === 'year') return { from: `${y}-01-01`, to: t };
    if (p === 'last30') return { from: addDays(t, -29), to: t };
    return { from: '2000-01-01', to: t }; };
  const inR = (d, r) => { const x = String(d || '').slice(0, 10); return x >= r.from && x <= r.to; };

  // ---------- chart primitives ----------
  const donut = (parts, center, sub) => {
    const tot = sum(parts, p => p.v); let off = 25;
    const segs = tot ? parts.filter(p => p.v > 0).map(p => { const pc = p.v / tot * 100; const s = `<circle r="15.9155" cx="18" cy="18" fill="none" stroke="${p.c}" stroke-width="4.2" stroke-dasharray="${pc.toFixed(2)} ${(100 - pc).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"><title>${esc(p.l)}: ${p.v}</title></circle>`; off -= pc; return s; }).join('') : '';
    return `<div class="dn"><svg viewBox="0 0 36 36" role="img" aria-label="${esc(center)}"><circle r="15.9155" cx="18" cy="18" fill="none" stroke="var(--d-line)" stroke-width="4.2"/>${segs}
      <text x="18" y="18.6" text-anchor="middle" class="dn-c">${esc(center)}</text><text x="18" y="23.2" text-anchor="middle" class="dn-s">${esc(sub || '')}</text></svg>
      <ul class="dn-l">${parts.map(p => `<li><i style="background:${p.c}"></i><span>${esc(p.l)}</span><b>${p.v}</b></li>`).join('')}</ul></div>`;
  };
  const hbars = (items, color, fmt = n0) => { const mx = Math.max(1, ...items.map(i => i.v));
    return items.length ? `<div class="hb">${items.map(i => `<div class="hb-r"><span class="hb-l" title="${esc(i.l)}">${esc(i.l)}</span><div class="hb-t"><i style="width:${Math.max(2, i.v / mx * 100)}%;background:${i.c || color}"></i></div><b>${fmt(i.v)}</b></div>`).join('')}</div>` : '<div class="d-empty">لا بيانات</div>'; };
  const duo = rows => { if (!rows.length) return '<div class="d-empty">لا بيانات</div>';
    const W = 560, H = 190, pl = 6, pb = 24, pt = 10, bw = (W - pl) / rows.length; const mx = Math.max(1, ...rows.flatMap(r => [N(r.revenue), N(r.expense)]));
    const h = v => (H - pb - pt) * N(v) / mx;
    return `<svg class="duo" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="الإيرادات مقابل المصروفات">${[0.25, 0.5, 0.75, 1].map(f => `<line x1="0" x2="${W}" y1="${(H - pb - (H - pb - pt) * f).toFixed(1)}" y2="${(H - pb - (H - pb - pt) * f).toFixed(1)}" stroke="var(--d-line)" stroke-dasharray="3 4"/>`).join('')}
      ${rows.map((r, i) => { const x = pl + i * bw + bw * 0.14, w = bw * 0.34;
        return `<rect x="${x.toFixed(1)}" y="${(H - pb - h(r.revenue)).toFixed(1)}" width="${w.toFixed(1)}" height="${h(r.revenue).toFixed(1)}" rx="3" fill="${C.teal}"><title>${r.month} إيرادات ${money(r.revenue)}</title></rect><rect x="${(x + w + 2).toFixed(1)}" y="${(H - pb - h(r.expense)).toFixed(1)}" width="${w.toFixed(1)}" height="${h(r.expense).toFixed(1)}" rx="3" fill="${C.amber}"><title>${r.month} مصروفات ${money(r.expense)}</title></rect><text x="${(pl + i * bw + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" class="ax">${String(r.month).slice(2)}</text>`; }).join('')}</svg>`; };
  const area = pts => { if (pts.length < 2) return '<div class="d-empty">لا بيانات كافية للاتجاه</div>';
    const W = 560, H = 150, mx = Math.max(1, ...pts.map(p => p.v)), st = W / (pts.length - 1);
    const xy = pts.map((p, i) => [i * st, H - 16 - (H - 30) * p.v / mx]);
    const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return `<svg class="duo" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="اتجاه المبيعات"><defs><linearGradient id="dg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.violet}" stop-opacity=".55"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></linearGradient></defs>
      <polygon points="0,${H - 16} ${line} ${W},${H - 16}" fill="url(#dg)"/><polyline points="${line}" fill="none" stroke="${C.violet}" stroke-width="2.4" stroke-linejoin="round"/>
      ${xy.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${C.violet}"><title>${pts[i].l}: ${money(pts[i].v)}</title></circle>`).join('')}
      <text x="2" y="${H - 2}" class="ax">${pts[0].l}</text><text x="${W - 2}" y="${H - 2}" text-anchor="end" class="ax">${pts[pts.length - 1].l}</text></svg>`; };
  const tile = (label, value, sub, c, go, unit = 'ر.س') => `<button class="kt" style="--kc:${c}" data-go="${go || ''}" ${go ? '' : 'tabindex="-1"'}><span>${esc(label)}</span><b class="n">${value}${unit ? `<small> ${unit}</small>` : ''}</b><em>${sub || '&nbsp;'}</em></button>`;
  const card = (t, body, cls = '') => `<section class="dc ${cls}"><h4>${esc(t)}</h4>${body}</section>`;

  // ---------- data ----------
  const safe = (p, fb) => p.catch(() => fb);
  const load = async () => {
    const t = today(), y0 = (() => { const d = new Date(t + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 11, 1); return ymd(d); })();
    const [inv, bk, ord, trf, bills, stock, emp, pay, cus, clm, lea, par, prod, ar, ap, per, chain, mon, bs] = await Promise.all([
      safe(api('/invoices?limit=500'), null), safe(api('/bookings'), null), safe(api('/orders'), null), safe(api('/transfers'), null), safe(api('/bills'), null), safe(api('/stock'), null),
      safe(api('/employees'), null), safe(api('/payroll/runs'), null), safe(api('/custodies'), null), safe(api('/expense-claims'), null), safe(api('/leases'), null), safe(api('/partners'), null), safe(api('/products'), null),
      safe(api('/reports/ar-aging?to=' + t), null), safe(api('/reports/ap-aging?to=' + t), null), safe(api('/periods'), null), safe(api('/reports/chain-verify'), null), safe(api(`/reports/monthly?from=${y0}&to=${t}`), []), safe(api('/reports/balance-sheet?to=' + t), null)]);
    return { inv, bk, ord, trf, bills, stock, emp, pay, cus, clm, lea, par, prod, ar, ap, per, chain, mon, bs, at: new Date() };
  };
  const loadIS = async r => safe(api(`/reports/income-statement?from=${r.from}&to=${r.to}`), null);

  // ---------- paint ----------
  const paint = (D, IS) => {
    const r = rangeOf(S.period), t = today();
    const inv = (D.inv || []).filter(i => inR(i.issue_at, r) && (S.kind === 'all' || i.kind === S.kind)), sg = i => i.kind === 'credit' ? -1 : 1;
    const billed = inv.filter(i => i.kind !== 'credit'), gross = sum(billed, i => N(i.total)), outst = sum(billed, i => N(i.outstanding)), rate = gross ? (gross - outst) / gross * 100 : 0;
    const sales = sum(inv, i => sg(i) * N(i.total)), vat = sum(inv, i => sg(i) * N(i.vat_amount));
    const rev = IS ? sum(IS.filter(x => x.type === 'revenue'), x => N(x.amount)) : null, exp = IS ? sum(IS.filter(x => x.type === 'expense'), x => N(x.amount)) : null;
    const cash = D.bs ? sum(D.bs.filter(x => (/^11[12]/.test(x.code)) && x.code !== '1120'), x => N(x.amount)) : null;
    const arTot = D.ar ? sum(D.ar, x => N(x.outstanding)) : null, apTot = D.ap ? sum(D.ap, x => N(x.outstanding)) : null;
    const late = D.ar ? D.ar.filter(x => N(x.outstanding) > 0 && x.due_date && String(x.due_date).slice(0, 10) < t) : [];
    const open = (a, f) => a ? a.filter(f).length : 0;
    const bkR = D.bk ? D.bk.filter(b => inR(b.scheduled_at, r)) : null, orR = D.ord ? D.ord.filter(o => inR(o.created_at, r)) : null;
    const cnt = (a, k) => a.reduce((m, x) => (m[x[k]] = (m[x[k]] || 0) + 1, m), {});
    const stat = (a, k, L, cols) => Object.entries(L).map(([key, l], i) => ({ l, v: cnt(a, k)[key] || 0, c: cols[i % cols.length] }));
    const keyN = (a, f) => a.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});

    // alerts
    const unpaidPay = D.pay ? D.pay.filter(x => !['paid', 'cancelled'].includes(x.status)) : [];
    const lowStock = D.stock ? (() => { const g = {}; D.stock.forEach(x => { g[x.id] = g[x.id] || { l: x.name_ar, v: 0 }; g[x.id].v += N(x.available); }); return Object.values(g); })() : null;
    const soon = D.lea ? D.lea.filter(l => l.status === 'active' && l.end_date && String(l.end_date).slice(0, 10) >= t && String(l.end_date).slice(0, 10) <= addDays(t, 60)) : [];
    const alerts = [
      [late.length, 'فواتير عملاء تجاوزت تاريخ الاستحقاق', C.coral, 'invoices', ` · ${money(sum(late, x => N(x.outstanding)))} ر.س`],
      [open(D.trf, x => x.status === 'pending'), 'حوالات بنكية معلّقة بانتظار المطابقة', C.amber, 'transfers', ''],
      [open(D.bk, x => x.status === 'new'), 'طلبات خدمة/حجوزات جديدة بانتظار التأكيد', C.sky, 'bookings', ''],
      [open(D.ord, x => x.status === 'new'), 'طلبات متجر إلكتروني جديدة', C.blue, 'orders', ''],
      [open(D.clm, x => x.status === 'submitted'), 'مطالبات مصروفات بانتظار الاعتماد', C.violet, 'expenses', ''],
      [unpaidPay.length, 'مسيّرات رواتب لم تُصرف بعد', C.amber, 'payroll', ''],
      [lowStock ? lowStock.filter(x => x.v <= 5).length : 0, 'أصناف مخزونها نافد أو منخفض (≤5)', C.coral, 'stock', ''],
      [soon.length, 'عقود إيجار تنتهي خلال 60 يوماً', C.amber, 'leases', ''],
      [D.bills ? D.bills.filter(b => N(b.outstanding) > 0 && b.due_date && String(b.due_date).slice(0, 10) < t).length : 0, 'فواتير موردين متأخرة السداد', C.coral, 'bills', '']
    ].filter(a => a[0] > 0);
    if (D.chain && !D.chain.ok) alerts.unshift([1, 'سلسلة تجزئة الدفتر مكسورة — راجع القيود فوراً', C.coral, 'journal', '']);

    // trend
    const span = (new Date(r.to) - new Date(r.from)) / 864e5, byDay = span <= 62, g = {};
    inv.forEach(i => { const k = String(i.issue_at).slice(0, byDay ? 10 : 7); g[k] = (g[k] || 0) + sg(i) * N(i.total); });
    const trend = Object.keys(g).sort().map(k => ({ l: byDay ? k.slice(5) : k, v: Math.max(0, g[k]) }));
    // top customers
    const tc = {}; billed.forEach(i => { const k = i.partner || 'عميل نقدي'; tc[k] = (tc[k] || 0) + N(i.total); });
    const topC = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, v]) => ({ l, v }));
    // aging
    const ORDER = ['غير مستحق', '1-30', '31-60', '61-90', '90+'], BC = [C.teal, C.amber, C.amber, C.coral, C.coral];
    const agg = rows => { const m = {}; (rows || []).forEach(x => { m[x.bucket] = (m[x.bucket] || 0) + N(x.outstanding); });
      return Object.keys(m).sort((x, y) => (ORDER.indexOf(x) + 1 || 9) - (ORDER.indexOf(y) + 1 || 9)).map(l => ({ l, v: m[l], c: BC[ORDER.indexOf(l)] || C.coral })); };
    // claims by category
    const cm = {}; (D.clm || []).filter(c => inR(c.expense_date, r) && !['draft', 'rejected'].includes(c.status)).forEach(c => { cm[c.category || 'أخرى'] = (cm[c.category || 'أخرى'] || 0) + N(c.total_amount); });
    const claimsC = Object.entries(cm).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, v]) => ({ l, v }));
    // employees
    const act = D.emp ? D.emp.filter(e => e.status === 'active') : [];
    const dep = Object.entries(keyN(act, e => e.department || 'غير محدد')).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, v]) => ({ l, v }));
    const lastPay = D.pay && D.pay[0];
    const cusAct = D.cus ? D.cus.filter(c => ['active', 'partially_settled'].includes(c.status)) : [];
    const leaAct = D.lea ? D.lea.filter(l => l.status === 'active') : [];
    const cap = D.inv && D.inv.length >= 500 ? '<div class="d-note">تُحسب مؤشرات الفواتير من آخر 500 فاتورة.</div>' : '';
    const stockParts = lowStock ? [{ l: 'نافد', v: lowStock.filter(x => x.v <= 0).length, c: C.coral }, { l: 'منخفض (≤5)', v: lowStock.filter(x => x.v > 0 && x.v <= 5).length, c: C.amber }, { l: 'متوفر', v: lowStock.filter(x => x.v > 5).length, c: C.teal }] : null;
    const lowList = lowStock ? lowStock.filter(x => x.v <= 5).sort((a, b) => a.v - b.v).slice(0, 5) : [];
    const mon = D.mon || [];

    $('#dash-body').innerHTML = `
      <div class="kts">
        ${rev === null ? '' : tile('الإيرادات', money(rev), 'من دفتر الأستاذ للفترة', C.teal, 'reports')}
        ${exp === null ? '' : tile('المصروفات', money(exp), 'من دفتر الأستاذ للفترة', C.violet, 'reports')}
        ${rev === null ? '' : tile('صافي الربح', money(rev - exp), `هامش الربح ${rev ? ((rev - exp) / rev * 100).toFixed(1) : '0.0'}%`, rev - exp >= 0 ? C.green : C.coral, 'reports')}
        ${cash === null ? '' : tile('النقد والبنوك', money(cash), 'حسابات 111x و112x', C.sky, 'accounts')}
        ${arTot === null ? '' : tile('ذمم العملاء المستحقة', money(arTot), `${late.length} فاتورة متأخرة`, C.amber, 'invoices')}
        ${apTot === null ? '' : tile('ذمم الموردين', money(apTot), `${D.ap.length} مستند`, C.blue, 'apay')}
        ${D.inv ? tile('ضريبة المخرجات', money(vat), 'صافي بعد الإشعارات', C.slate, 'reports') : ''}
        ${D.inv ? tile('عدد الفواتير', n0(inv.length), `قيمتها ${money(sales)} ر.س`, C.teal, 'invoices', '') : ''}
      </div>${cap}
      <div class="dg dg3">
        ${D.inv ? card('نسبة التحصيل', donut([{ l: 'محصّل', v: Math.round(gross - outst), c: C.teal }, { l: 'متبقٍ', v: Math.round(outst), c: C.coral }], rate.toFixed(0) + '%', 'محصّل'), '') : ''}
        ${D.inv ? card('الفواتير حسب النوع', donut(Object.entries(KL).map(([k, l], i) => ({ l, v: inv.filter(x => x.kind === k).length, c: [C.teal, C.violet, C.coral, C.amber][i] })), n0(inv.length), 'فاتورة'), '') : ''}
        ${bkR ? card('طلبات الخدمة والحجوزات', donut(stat(bkR, 'status', BK, [C.sky, C.blue, C.amber, C.teal, C.slate]), n0(bkR.length), 'حجز'), '') : ''}
      </div>
      <div class="dg dg2">
        ${card('الإيراد مقابل المصروف — آخر 12 شهراً', `${duo(mon)}<div class="lg"><i style="background:${C.teal}"></i>إيرادات <i style="background:${C.amber}"></i>مصروفات</div>`)}
        ${D.inv ? card(`اتجاه المبيعات (${byDay ? 'يومي' : 'شهري'})`, area(trend)) : ''}
      </div>
      <div class="dg dg3">
        ${D.inv ? card('أعلى العملاء مبيعاً', hbars(topC, C.teal)) : ''}
        ${D.ar ? card('أعمار الذمم المدينة', hbars(agg(D.ar), C.coral)) : ''}
        ${D.ap ? card('أعمار الذمم الدائنة', hbars(agg(D.ap), C.amber)) : ''}
      </div>
      <div class="dg dg3">
        ${orR ? card('طلبات المتجر الإلكتروني', donut(stat(orR, 'status', OR, [C.sky, C.blue, C.teal, C.slate]), n0(orR.length), 'طلب'), '') : ''}
        ${stockParts ? card('صحة المخزون', `${donut(stockParts, n0(lowStock.length), 'صنف')}${lowList.length ? `<ul class="lst">${lowList.map(x => `<li><span>${esc(x.l)}</span><b class="${x.v <= 0 ? 'bad' : 'warn'}">${n0(x.v)}</b></li>`).join('')}</ul>` : ''}`) : ''}
        ${D.clm ? card('المصروفات حسب البند', hbars(claimsC, C.violet)) : ''}
      </div>
      <div class="dg dg3">
        ${D.emp ? card('الموارد البشرية', `${donut(Object.entries(ES).map(([k, l], i) => ({ l, v: D.emp.filter(e => e.status === k).length, c: [C.teal, C.amber, C.slate][i] })), n0(D.emp.length), 'موظف')}${hbars(dep, C.blue)}`) : ''}
        ${D.pay || D.cus ? card('الرواتب والعهد', `<ul class="lst">
          ${lastPay ? `<li><span>آخر مسيّر (${esc(lastPay.period_name)})</span><b>${esc({ draft: 'مسودة', reviewed: 'مراجَع', approved: 'معتمد', posted: 'مرحَّل', paid: 'مصروف', cancelled: 'ملغي' }[lastPay.status] || lastPay.status)}</b></li><li><span>صافي آخر مسيّر</span><b class="n">${money(lastPay.total_net)}</b></li><li><span>عدد موظفي المسيّر</span><b>${n0(lastPay.employee_count)}</b></li>` : ''}
          ${D.cus ? `<li><span>عهد جارية</span><b>${cusAct.length}</b></li><li><span>رصيد العهد القائم</span><b class="n">${money(sum(cusAct, c => N(c.balance)))}</b></li>` : ''}</ul>`) : ''}
        ${D.lea ? card('عقود الإيجار', `<ul class="lst"><li><span>عقود سارية</span><b>${leaAct.length}</b></li><li><span>الإيجار السنوي للعقود السارية</span><b class="n">${money(sum(leaAct, l => N(l.annual_rent)))}</b></li>
          ${soon.slice(0, 4).map(l => `<li><span>${esc(l.tenant)} · ${esc(l.unit_no || '')}</span><b class="warn">${String(l.end_date).slice(0, 10)}</b></li>`).join('') || '<li><span>لا عقود تنتهي خلال 60 يوماً</span><b>✓</b></li>'}</ul>`) : ''}
      </div>
      <div class="dg dg2">
        ${card(`تنبيهات تحتاج إجراءً (${alerts.length})`, alerts.length ? `<ul class="al">${alerts.map(([c, t2, col, go, ex]) => `<li><button data-go="${go}" style="--kc:${col}"><b>${n0(c)}</b><span>${esc(t2)}${ex}</span><em>فتح ←</em></button></li>`).join('')}</ul>` : '<div class="d-ok">✓ لا توجد بنود معلّقة الآن</div>')}
        ${card('سلامة النظام ومركز العدّادات', `<div class="hl">${D.chain ? (D.chain.ok ? '<span class="tag t-ok">سلسلة الدفتر سليمة</span>' : `<span class="tag t-bad">انكسرت السلسلة عند ${esc(D.chain.first_bad_entry)}</span>`) : ''} ${D.per ? `<span class="tag t-open">فترات مفتوحة: ${D.per.filter(p => p.status === 'open').length}</span> <span class="tag t-closed">مقفلة: ${D.per.filter(p => p.status !== 'open').length}</span>` : ''}</div>
          <div class="cn">${[['الفواتير', D.inv ? (D.inv.length >= 500 ? '500+' : D.inv.length) : null, 'invoices'], ['قيود اليومية', D.chain ? D.chain.entries : null, 'journal'], ['العملاء', D.par ? D.par.filter(p => p.kind !== 'vendor').length : null, 'partners'], ['الموردون', D.par ? D.par.filter(p => p.kind === 'vendor').length : null, 'vendors'], ['الأصناف', D.prod ? D.prod.length : null, 'products'], ['الموظفون', D.emp ? D.emp.length : null, 'employees'], ['الحجوزات', D.bk ? D.bk.length : null, 'bookings'], ['الطلبات', D.ord ? D.ord.length : null, 'orders'], ['فواتير الموردين', D.bills ? D.bills.length : null, 'bills'], ['الحوالات', D.trf ? D.trf.length : null, 'transfers']].filter(x => x[1] !== null).map(([l, v, go]) => `<button data-go="${go}"><b class="n">${v}</b><span>${l}</span></button>`).join('')}</div>`)}
      </div>`;
    X.bindDash?.();
  };

  // ---------- view ----------
  let timer = null;
  VIEWS.dashboard = async function (m) {
    const co = await api('/company').catch(() => ({ name_ar: '' }));
    const draw = async (reload) => {
      const box = $('#dash-body'); if (reload) box.classList.add('busy');
      if (reload || !m._D) m._D = await load();
      const r = rangeOf(S.period); const IS = await loadIS(r);
      paint(m._D, IS); box.classList.remove('busy');
      const stamp = $('#dash-stamp'); if (stamp) stamp.textContent = 'آخر تحديث: ' + m._D.at.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    };
    m.innerHTML = head('لوحة التحكم', esc(co.name_ar || ''), '<button class="btn ghost" id="d-ref">⟳ تحديث</button> <button class="btn ghost" id="d-th">◐ الوضع</button> <button class="btn ghost" id="d-pr">🖨️ طباعة</button>') +
      `<div class="dash ${S.theme}" id="dash">
        <div class="slc noprint"><div class="sg"><span>الفترة</span>${PERIODS.map(([k, l]) => `<button class="sc ${S.period === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
          <div class="sg"><span>نوع الفاتورة</span>${KINDS.map(([k, l]) => `<button class="sc ${S.kind === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
          <label class="au"><input type="checkbox" id="d-au" ${S.auto ? 'checked' : ''}> تحديث تلقائي كل دقيقتين</label><span class="sub" id="dash-stamp"></span></div>
        <div id="dash-body"><div class="d-empty">جارٍ التحميل…</div></div></div>`;
    X.bindDash = () => {
      m.querySelectorAll('[data-go]').forEach(b => { if (b.dataset.go) b.onclick = () => X.go(b.dataset.go); });
    };
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { S.period = b.dataset.p; ls.set('dash_period', S.period); m.querySelectorAll('[data-p]').forEach(x => x.classList.toggle('on', x === b)); draw(false); });
    m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { S.kind = b.dataset.k; m.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === b)); draw(false); });
    $('#d-ref').onclick = () => draw(true);
    $('#d-th').onclick = () => { S.theme = S.theme === 'dk' ? 'lt' : 'dk'; ls.set('dash_theme', S.theme); $('#dash').className = 'dash ' + S.theme; };
    $('#d-pr').onclick = () => window.print();
    $('#d-au').onchange = e => { S.auto = e.target.checked; ls.set('dash_auto', S.auto ? '1' : '0'); };
    clearInterval(timer);
    timer = setInterval(() => { if (!document.getElementById('dash')) return clearInterval(timer); if (S.auto && !document.hidden) draw(true).catch(() => {}); }, 120000);
    await draw(true); done(m);
  };
}
