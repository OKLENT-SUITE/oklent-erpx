// OKLENT-ERPX public storefront (v0.7). No login. https://oklent.net/
// Prices on screen are a DISPLAY ESTIMATE: the server (PostgreSQL place_online_order) recomputes every amount, stock check, discount, VAT and delivery fee at checkout.
(async () => {
  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
  const root = document.getElementById('root');
  const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
  const PATH = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>', user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>', minus: '<path d="M5 12h14"/>', check: '<path d="M20 6 9 17l-5-5"/>', trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'
  };
  const ic = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${PATH[n]}</svg>`;
  const fail = (t, retry) => { root.innerHTML = `<div class="wrap"><div class="empty"><div class="big">🛍️</div><h2>${t}</h2>${retry ? '<button class="btn" id="rt">إعادة المحاولة</button>' : ''}</div></div>`; document.getElementById('rt')?.addEventListener('click', () => location.reload()); };

  let data;
  try {
    const r = await fetch('/api/public/store/' + encodeURIComponent(slug));
    if (r.status === 404) return fail('المتجر غير متاح حالياً');
    if (!r.ok) return fail('تعذّر تحميل المتجر مؤقتاً، حاول بعد قليل', true);
    data = await r.json();
  } catch { return fail('تعذّر الاتصال بالخادم، تحقق من الاتصال', true); }

  const { store, site } = data;
  const F = f => (store.features || []).includes(f);
  const PAY = { cod: 'الدفع عند الاستلام', bank_transfer: 'حوالة بنكية', mada: 'مدى', card: 'بطاقة ائتمانية' };
  const KIND = { goods: 'منتجات', service: 'خدمات', rental: 'تأجير' };
  const name = site.title_ar || store.name_ar;
  if (/^#[0-9a-fA-F]{6}$/.test(site.theme_color || '')) { document.documentElement.style.setProperty('--c', site.theme_color); document.querySelector('meta[name=theme-color]')?.setAttribute('content', site.theme_color); }
  document.title = name; document.querySelector('meta[name=description]')?.setAttribute('content', (site.tagline_ar || site.about_ar || name).slice(0, 160));

  // ---------- catalogue ----------
  const safeImg = u => (/^(https:\/\/|\/)/.test(u || '') ? u : '');
  const catOf = p => p.category || 'منتجات';
  const P = data.products.map(p => { const sale = +p.sale_price, disc = +p.unit_discount, rate = +p.vat_rate;
    return { ...p, id: +p.id, sale, disc, rate, price: +p.price_incl_vat, max: Math.max(0, +p.max_qty), pct: sale > 0 ? Math.round(disc / sale * 100) : 0, was: r2(sale * (1 + rate / 100)), img: safeImg(p.image_url) }; });
  const byId = new Map(P.map(p => [p.id, p]));
  const goods = P.filter(p => p.kind === 'goods'), svcs = P.filter(p => p.kind === 'service'), rents = P.filter(p => p.kind === 'rental'), bookable = [...svcs, ...rents];
  const bookingOn = F('booking') && bookable.length > 0;          // the server (place_booking) refuses bookings unless the store has the «booking» feature
  const cats = [...new Set(goods.map(catOf))];
  const norm = s => String(s || '').toLowerCase().replace(/[\u064B-\u065F\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const emoji = p => p.kind === 'service' ? '🛠️' : p.kind === 'rental' ? '🎪' : '🎁';

  // ---------- local state (cart / wishlist live in this browser only) ----------
  const LS = { get(k, d) { try { return JSON.parse(localStorage.getItem(`erpx:${slug}:${k}`)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(`erpx:${slug}:${k}`, JSON.stringify(v)); } catch { /* private mode: keep working in memory */ } } };
  const cart = new Map(); for (const [id, q] of LS.get('cart', [])) { const p = byId.get(+id); if (p && p.kind === 'goods' && p.in_stock && q > 0) cart.set(p.id, Math.min(+q, p.max)); }
  const wish = new Set((LS.get('wish', []) || []).map(Number).filter(id => byId.has(id)));
  const saveCart = () => LS.set('cart', [...cart]); const saveWish = () => LS.set('wish', [...wish]);
  const S = { q: '', cat: 'all', sort: 'def', stock: false, off: false, wish: false, shown: 24 };

  // ---------- money (mirrors place_online_order; thresholds compare the amount EXCLUDING VAT) ----------
  const hasDelivery = F('delivery') && +site.delivery_fee > 0, freeOver = site.free_delivery_over == null ? null : +site.free_delivery_over, minOrder = +site.min_order || 0;
  function totals() {
    let net = 0, vat = 0, count = 0;
    for (const [id, q] of cart) { const p = byId.get(id); const d = r2(q * p.disc), n = r2(q * p.sale - d); net += n; vat += r2(n * p.rate / 100); count += q; }
    net = r2(net); vat = r2(vat); let dfee = 0, dvat = 0;
    if (cart.size && hasDelivery && (freeOver === null || net < freeOver)) { dfee = +site.delivery_fee; dvat = r2(dfee * .15); }
    return { net, vat, dfee, dvat, count, total: r2(net + vat + dfee + dvat) };
  }
  const waNum = (() => { let d = String(site.whatsapp || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (/^05\d{8}$/.test(d)) d = '966' + d.slice(1); return /^\d{9,15}$/.test(d) ? d : ''; })();
  const telHref = /^[+\d][\d\s-]{6,}$/.test(site.phone || '') ? 'tel:' + String(site.phone).replace(/[^\d+]/g, '') : '';
  const mailOk = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(site.email || '');

  // ---------- shell (rendered once; only the pieces below are redrawn so the search box never loses focus) ----------
  const annText = hasDelivery && freeOver !== null ? `🚚 توصيل مجاني للطلبات فوق <b class="n">${money(freeOver)}</b> ر.س (قبل الضريبة)` : (site.tagline_ar ? esc(site.tagline_ar) : 'مرحباً بكم في متجرنا');
  root.innerHTML = `
  <div class="ann">${annText}</div>
  <header class="top"><div class="wrap hd">
    <a class="brand" href="/shop/${esc(store.slug)}"><span class="lg">🛍️</span><span>${esc(name)}</span></a>
    <div class="srch" role="search"><input id="q" type="search" placeholder="ابحث عن منتج أو خدمة…" autocomplete="off" aria-label="بحث"><span>${ic('search')}</span><ul id="sg" hidden></ul></div>
    <div class="actions"><a class="btn ghost sm sysl" id="sys" href="/" title="العودة إلى النظام" aria-label="العودة إلى النظام">${ic('user')}<span>النظام</span></a><button class="ib" id="wb" aria-label="المفضلة">${ic('heart')}<span class="bdg" id="wc" hidden>0</span></button><button class="ib" id="cb" aria-label="سلة التسوق">${ic('cart')}<span class="bdg" id="cc" hidden>0</span></button></div>
  </div></header>
  <main class="wrap" id="top">
    <section class="hero"><h1>${esc(name)}</h1><p>${esc(site.tagline_ar || site.about_ar || '')}</p><a class="btn" href="#list">تسوّق الآن ${ic('cart')}</a></section>
    <section class="trust" aria-label="مزايا المتجر">
      <div>${ic('truck')}<p style="margin:0"><b>${hasDelivery ? 'توصيل سريع' : 'خدمة العملاء'}</b><span>${hasDelivery ? (freeOver !== null ? 'مجاني فوق ' + money(freeOver) + ' ر.س' : 'رسوم ' + money(site.delivery_fee) + ' ر.س') : 'نخدمك على مدار الأسبوع'}</span></p></div>
      <div>${ic('shield')}<p style="margin:0"><b>دفع آمن</b><span>${site.payment_methods.map(m => PAY[m] || m).join(' · ')}</span></p></div>
      <div>${ic('undo')}<p style="margin:0"><b>سياسة استرجاع</b><span>${site.return_policy_ar ? 'مذكورة أسفل الصفحة' : 'تواصل معنا'}</span></p></div>
      <div>${ic('chat')}<p style="margin:0"><b>دعم مباشر</b><span>${waNum ? 'واتساب' : site.phone ? 'اتصال هاتفي' : 'عبر البريد'}</span></p></div>
    </section>
    <nav class="secnav" id="sn" aria-label="أقسام المتجر"></nav>
    <div id="offers"></div>
    <section id="sec-goods"><h2 class="sec" id="list">المنتجات <small id="cnt"></small></h2>
      <div class="chips" id="chips" role="tablist" aria-label="التصنيفات"></div>
      <div class="tb"><span class="cnt" id="cnt2"></span>
        <label class="tg"><input type="checkbox" id="st"> متوفر فقط</label><label class="tg"><input type="checkbox" id="of"> عروض فقط</label>
        <select id="so" aria-label="الترتيب"><option value="def">الترتيب الافتراضي</option><option value="pa">السعر: الأقل أولاً</option><option value="pd">السعر: الأعلى أولاً</option><option value="ds">الأعلى خصماً</option><option value="nm">الاسم (أ–ي)</option></select></div>
      <div class="grid" id="grid"></div><div style="text-align:center;margin:18px"><button class="btn ghost" id="more" hidden>عرض المزيد</button></div></section>
    <section id="sec-svc" hidden><h2 class="sec" id="services">الخدمات <small>صيانة وخدمات ما بعد البيع</small></h2><div class="grid" id="sgrid"></div></section>
    <section id="sec-book" hidden><h2 class="sec" id="bookings">طلب خدمة وحجز <small>موعد فني أو تأجير مع إمكانية إضافة منتجات</small></h2>
      <div class="bookbox" id="bkbox"><div><b>احجز موعدك بسهولة</b><p class="vt" style="margin:4px 0 0">اختر الخدمة أو التأجير وأضف ما تحتاجه من منتجات، ثم حدّد الموقع والموعد. يؤكد فريقنا الموعد ويُسند الفني.</p></div>
        <label class="fl" style="min-width:240px;flex:1">الخدمة / التأجير<select id="bk">${bookable.map(p => `<option value="${p.id}">${esc(p.name_ar)} — ${money(p.price)} ر.س</option>`).join('')}</select></label><button class="btn" id="bkb" data-act="book-sel">احجز موعد فني</button></div>
      <div class="grid" id="rgrid"></div></section>
    ${site.about_ar ? `<h2 class="sec">عن المتجر</h2><p style="max-width:780px">${esc(site.about_ar)}</p>` : ''}
  </main>
  <footer class="ft"><div class="wrap"><div class="fg4">
    <div><h4>${esc(name)}</h4><p>${esc(site.about_ar || site.tagline_ar || '')}</p></div>
    <div><h4>تواصل معنا</h4><ul><li><a href="/" id="sysf">الدخول إلى النظام (للموظفين)</a></li>${site.phone ? `<li>☎ ${telHref ? `<a class="n" href="${esc(telHref)}">${esc(site.phone)}</a>` : `<span class="n">${esc(site.phone)}</span>`}</li>` : ''}${waNum ? `<li><a href="https://wa.me/${waNum}" target="_blank" rel="noopener">واتساب</a></li>` : ''}${mailOk ? `<li><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></li>` : ''}</ul></div>
    <div><h4>الشحن والدفع</h4><p>${hasDelivery ? `رسوم التوصيل ${money(site.delivery_fee)} ر.س${freeOver !== null ? ` — مجاني فوق ${money(freeOver)} ر.س` : ''} (قبل الضريبة)` : 'يُحدَّد التوصيل عند تأكيد الطلب'}${minOrder ? `<br>الحد الأدنى للطلب ${money(minOrder)} ر.س قبل الضريبة` : ''}</p><div class="pm">${site.payment_methods.map(m => `<span>${esc(PAY[m] || m)}</span>`).join('')}</div></div>
    ${site.return_policy_ar ? `<div><h4>سياسة الاسترجاع</h4><p>${esc(site.return_policy_ar)}</p></div>` : ''}
  </div><div class="cp">الأسعار المعروضة شاملة ضريبة القيمة المضافة · <span dir="ltr">© 2026 OKLENT BUSINESS.</span> جميع الحقوق محفوظة</div></div></footer>
  ${waNum ? `<a class="wa" href="https://wa.me/${waNum}" target="_blank" rel="noopener" aria-label="تواصل عبر واتساب"><svg class="i" viewBox="0 0 24 24" aria-hidden="true">${PATH.chat}</svg></a>` : ''}
  <div class="bar" id="bar"><span id="barx"></span><button class="btn" id="barb">عرض السلة</button></div>
  <div class="ov" id="ov"></div>
  <aside class="drawer" id="dr" role="dialog" aria-modal="true" aria-label="سلة التسوق"><header><h3>سلة التسوق</h3><button class="ib" data-act="close-cart" aria-label="إغلاق">${ic('x')}</button></header><div class="bodyx" id="drb"></div><footer id="drf"></footer></aside>
  <dialog id="pdlg" aria-label="تفاصيل المنتج"></dialog><dialog id="cdlg" aria-label="إتمام الطلب"></dialog><dialog id="bdlg" aria-label="حجز"></dialog>`;
  const $ = s => root.querySelector(s);
  const toast = t => { const e = document.createElement('div'); e.className = 'toast'; e.setAttribute('role', 'status'); e.textContent = t; document.body.appendChild(e); setTimeout(() => e.remove(), 2200); };

  // ---------- list ----------
  const hit = p => { const q = norm(S.q.trim()); return !q || norm(p.name_ar + ' ' + (p.description_ar || '') + ' ' + catOf(p)).includes(q); };
  const visible = () => {
    let a = goods.filter(p => (S.cat === 'all' || catOf(p) === S.cat) && (!S.stock || p.in_stock) && (!S.off || p.disc > 0) && (!S.wish || wish.has(p.id)) && hit(p));
    if (S.sort === 'pa') a = [...a].sort((x, y) => x.price - y.price); else if (S.sort === 'pd') a = [...a].sort((x, y) => y.price - x.price); else if (S.sort === 'ds') a = [...a].sort((x, y) => y.pct - x.pct); else if (S.sort === 'nm') a = [...a].sort((x, y) => x.name_ar.localeCompare(y.name_ar, 'ar'));
    return a;
  };
  const others = list => list.filter(p => (!S.off || p.disc > 0) && (!S.wish || wish.has(p.id)) && hit(p));
  const priceHTML = p => `<div class="pr"><b class="n">${money(p.price)}</b><small>ر.س</small>${p.disc > 0 ? `<s class="n">${money(p.was)}</s>` : ''}</div>`;
  const buyBtn = p => p.kind === 'rental' ? (bookingOn ? `<button class="btn block" data-act="book" data-id="${p.id}">احجز التأجير</button>` : `<button class="btn ghost block" data-act="open" data-id="${p.id}">التفاصيل</button>`)
    : p.kind === 'service' ? (bookingOn ? `<button class="btn block" data-act="pick-svc" data-id="${p.id}">اطلب الخدمة</button>` : `<button class="btn ghost block" data-act="open" data-id="${p.id}">التفاصيل</button>`)
    : !p.in_stock ? '<button class="btn block" disabled>نفدت الكمية</button>'
    : cart.has(p.id) ? `<div class="qty"><button data-act="dec" data-id="${p.id}" aria-label="إنقاص">${cart.get(p.id) === 1 ? ic('trash') : ic('minus')}</button><span class="n">${cart.get(p.id)}</span><button data-act="inc" data-id="${p.id}" aria-label="زيادة" ${cart.get(p.id) >= p.max ? 'disabled' : ''}>${ic('plus')}</button></div>`
    : `<button class="btn block" data-act="add" data-id="${p.id}">${ic('cart')} أضف للسلة</button>`;
  const badges = p => `<div class="bd">${p.pct > 0 ? `<span class="pill off">خصم ${p.pct}%</span>` : ''}${p.kind === 'goods' && !p.in_stock ? '<span class="pill out">نفدت</span>' : p.kind === 'goods' && p.max <= 5 ? `<span class="pill low">آخر ${p.max}</span>` : ''}${p.kind === 'rental' ? '<span class="pill">للتأجير</span>' : p.kind === 'service' ? '<span class="pill">خدمة</span>' : ''}</div>`;
  const card = p => `<article class="pc" data-card="${p.id}"><button class="im" data-act="open" data-id="${p.id}" aria-label="${esc(p.name_ar)}">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : `<div class="ph">${emoji(p)}</div>`}</button>${badges(p)}
    <button class="wh ${wish.has(p.id) ? 'on' : ''}" data-act="wish" data-id="${p.id}" aria-label="المفضلة" aria-pressed="${wish.has(p.id)}">${ic('heart')}</button>
    <div class="b"><span class="cat">${esc(catOf(p))}</span><h3 data-act="open" data-id="${p.id}">${esc(p.name_ar)}</h3>${priceHTML(p)}<span class="vt">شامل ضريبة القيمة المضافة ${p.rate}%</span>${buyBtn(p)}</div></article>`;
  function drawChips() {
    const n = c => goods.filter(p => catOf(p) === c).length;
    $('#chips').innerHTML = cats.length > 1 ? `<button class="chip ${S.cat === 'all' ? 'on' : ''}" data-cat="all" role="tab">الكل<small>${goods.length}</small></button>` + cats.map(c => `<button class="chip ${S.cat === c ? 'on' : ''}" data-cat="${esc(c)}" role="tab">${esc(c)}<small>${n(c)}</small></button>`).join('') : '';
  }
  function drawList() {
    const a = visible(), pg = a.slice(0, S.shown), sv = others(svcs), rt = others(rents); const filtering = S.q || S.cat !== 'all' || S.stock || S.off || S.wish;
    $('#cnt2').textContent = `${a.length} نتيجة`; $('#cnt').textContent = S.wish ? '— المفضلة' : '';
    const none = !a.length && !sv.length && !rt.length;
    $('#sec-goods').hidden = !goods.length && !none;
    $('#grid').innerHTML = pg.map(card).join('') || (goods.length || none ? `<div class="empty" style="grid-column:1/-1"><div class="big">${S.wish ? '💔' : '🔍'}</div><p>${S.wish ? 'لا توجد منتجات في المفضلة بعد' : P.length ? 'لا نتائج مطابقة — جرّب تغيير البحث أو التصفية' : 'لا توجد منتجات منشورة حالياً'}</p>${filtering ? '<button class="btn ghost" data-act="reset">مسح التصفية</button>' : ''}</div>` : '');
    $('#more').hidden = a.length <= S.shown;
    const showOffers = S.cat === 'all' && !S.q && !S.off && !S.wish; const offs = showOffers ? goods.filter(p => p.disc > 0 && p.in_stock).slice(0, 12) : [];
    $('#offers').innerHTML = offs.length ? `<h2 class="sec">🔥 عروض خاصة <small>خصومات سارية الآن</small></h2><div class="strip">${offs.map(card).join('')}</div>` : '';
    $('#sec-svc').hidden = !sv.length; $('#sgrid').innerHTML = sv.map(card).join('');
    $('#sec-book').hidden = !bookingOn; $('#rgrid').innerHTML = rt.map(card).join('');
    const links = [[goods.length, 'list', 'المنتجات', goods.length], [svcs.length, 'services', 'الخدمات', svcs.length], [bookingOn, 'bookings', 'الحجوزات', '']].filter(x => x[0]);
    $('#sn').innerHTML = links.length > 1 ? links.map(([, id, t, n]) => `<a class="chip" href="#${id}">${t}${n ? `<small>${n}</small>` : ''}</a>`).join('') : '';
  }
  const redrawCards = id => { root.querySelectorAll(`[data-card="${id}"]`).forEach(el => { const p = byId.get(id); const t = document.createElement('div'); t.innerHTML = card(p); el.replaceWith(t.firstElementChild); }); };
  function drawBadges() { const t = totals(); const set = (id, n) => { const e = $(id); e.textContent = n; e.hidden = !n; }; set('#cc', t.count); set('#wc', wish.size);
    $('#bar').classList.toggle('on', t.count > 0 && !$('#dr').classList.contains('on')); $('#barx').innerHTML = `🛒 ${t.count} صنف — <b class="n">${money(t.total)} ر.س</b>`; }

  // ---------- cart ----------
  function drawCart() {
    const t = totals(); const items = [...cart];
    $('#drb').innerHTML = items.map(([id, q]) => { const p = byId.get(id); return `<div class="ci">${p.img ? `<img class="th" src="${esc(p.img)}" alt="">` : `<div class="th">${emoji(p)}</div>`}<div><h4>${esc(p.name_ar)}</h4><div class="rw"><div class="qty"><button data-act="dec" data-id="${id}" aria-label="إنقاص">${ic('minus')}</button><span class="n">${q}</span><button data-act="inc" data-id="${id}" aria-label="زيادة" ${q >= p.max ? 'disabled' : ''}>${ic('plus')}</button></div><b class="n">${money(q * p.price)}</b></div><button class="rm" data-act="rm" data-id="${id}">${ic('trash')} إزالة</button></div></div>`; }).join('')
      || '<div class="empty"><div class="big">🛒</div><p>سلتك فارغة</p><button class="btn" data-act="close-cart">تصفّح المنتجات</button></div>';
    let prog = ''; if (items.length && hasDelivery && freeOver !== null) { const left = r2(freeOver - t.net); prog = left > 0 ? `<div class="prog">أضف <b class="n">${money(left)}</b> ر.س (قبل الضريبة) للحصول على توصيل مجاني<i><u style="width:${Math.min(100, Math.round(t.net / freeOver * 100))}%"></u></i></div>` : '<div class="prog">🎉 حصلت على توصيل مجاني<i><u style="width:100%"></u></i></div>'; }
    const short = items.length && t.net < minOrder ? `<div class="msg err" style="margin:0">الحد الأدنى للطلب ${money(minOrder)} ر.س قبل الضريبة — يلزم إضافة ${money(r2(minOrder - t.net))} ر.س</div>` : '';
    $('#drf').innerHTML = items.length ? `${prog}${short}<div class="tot"><div><span>المجموع قبل الضريبة</span><span class="n">${money(t.net)}</span></div><div><span>ضريبة القيمة المضافة</span><span class="n">${money(t.vat)}</span></div>${hasDelivery ? `<div><span>التوصيل</span><span class="n">${t.dfee ? money(r2(t.dfee + t.dvat)) : 'مجاني'}</span></div>` : ''}<div class="g"><span>الإجمالي</span><span class="n">${money(t.total)} ر.س</span></div></div><button class="btn block" data-act="checkout" ${t.net < minOrder ? 'disabled' : ''}>إتمام الطلب</button><small style="color:var(--mut)">المبلغ النهائي يحسبه الخادم عند تأكيد الطلب.</small>` : '';
  }
  const openCart = () => { drawCart(); $('#dr').classList.add('on'); $('#ov').classList.add('on'); drawBadges(); $('#dr').querySelector('button')?.focus(); };
  const closeCart = () => { $('#dr').classList.remove('on'); $('#ov').classList.remove('on'); drawBadges(); };
  const refresh = id => { saveCart(); drawBadges(); if (id) redrawCards(id); if ($('#dr').classList.contains('on')) drawCart(); const pd = $('#pdlg'); if (pd.open && pd.dataset.id === String(id)) drawProduct(id, true); };
  function setQty(id, q) { const p = byId.get(id); if (!p || p.kind !== 'goods') return; q = Math.min(q, p.max); if (q <= 0) cart.delete(id); else cart.set(id, q); refresh(id); }
  function addToCart(id, n = 1) { const p = byId.get(id); if (!p || !p.in_stock) return; const cur = cart.get(id) || 0; if (cur + n > p.max) { toast(`الكمية المتاحة ${p.max} فقط`); setQty(id, p.max); return; } setQty(id, cur + n); toast('أُضيف إلى السلة'); }
  function toggleWish(id) { wish.has(id) ? wish.delete(id) : wish.add(id); saveWish(); drawBadges(); redrawCards(id); if (S.wish) drawList(); }

  // ---------- product dialog ----------
  function drawProduct(id, keepQty) {
    const p = byId.get(id), d = $('#pdlg'); const keep = keepQty ? +(d.querySelector('#pq')?.value || 1) : 1; d.dataset.id = id;
    const rel = P.filter(x => x.id !== id && catOf(x) === catOf(p)).slice(0, 4);
    d.innerHTML = `<div class="dh"><h3>${esc(catOf(p))}</h3><button class="ib" data-act="close-dlg" aria-label="إغلاق">${ic('x')}</button></div><div class="dbody"><div class="pd"><div class="big">${p.img ? `<img src="${esc(p.img)}" alt="${esc(p.name_ar)}">` : `<div class="ph">${emoji(p)}</div>`}</div>
      <div><h2>${esc(p.name_ar)}</h2>${p.pct > 0 ? `<span class="pill off">خصم ${p.pct}%</span> ` : ''}${p.kind === 'goods' ? (p.in_stock ? (p.max <= 5 ? `<span class="pill low">آخر ${p.max} قطع</span>` : '<span class="pill ok">متوفر</span>') : '<span class="pill out">نفدت الكمية</span>') : `<span class="pill">${p.kind === 'rental' ? 'للتأجير' : 'خدمة'}</span>`}
      <div style="margin:12px 0">${priceHTML(p)}<span class="vt">شامل ضريبة القيمة المضافة ${p.rate}% · السعر قبل الضريبة <span class="n">${money(p.sale - p.disc)}</span></span></div>
      ${p.description_ar ? `<p>${esc(p.description_ar)}</p>` : ''}<p class="vt">الوحدة: ${esc(p.unit || 'قطعة')}</p>
      ${p.kind === 'goods' && p.in_stock ? `<div style="display:flex;gap:8px;align-items:center;margin-top:10px"><label class="sr" for="pq">الكمية</label><input id="pq" class="n" type="number" min="1" max="${p.max}" value="${Math.min(keep, p.max)}" style="width:84px;height:44px;border:1px solid var(--line);border-radius:12px;padding:0 10px;background:var(--bg);color:var(--ink);font:inherit"><button class="btn" style="flex:1" data-act="add-qty" data-id="${p.id}">${ic('cart')} أضف للسلة</button></div>` : `<div style="margin-top:10px">${buyBtn(p)}</div>`}
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn ghost sm" data-act="wish" data-id="${p.id}">${ic('heart')} ${wish.has(p.id) ? 'في المفضلة' : 'أضف للمفضلة'}</button><button class="btn ghost sm" data-act="copy" data-id="${p.id}">${ic('link')} نسخ الرابط</button></div></div></div>
      ${rel.length ? `<h2 class="sec" style="font-size:17px">منتجات مشابهة</h2><div class="strip">${rel.map(card).join('')}</div>` : ''}</div>`;
  }
  function openProduct(id) { if (!byId.has(id)) return; drawProduct(id); const d = $('#pdlg'); if (!d.open) d.showModal(); history.replaceState(null, '', '#p' + id); }
  $('#pdlg').addEventListener('close', () => history.replaceState(null, '', location.pathname + location.search));

  // ---------- checkout ----------
  const digits = s => String(s || '').replace(/[\u0660-\u0669]/g, c => c.charCodeAt(0) - 0x660).replace(/[\u06F0-\u06F9]/g, c => c.charCodeAt(0) - 0x6F0).replace(/[\s\-()]/g, '').replace(/^00/, '+');
  function openCheckout() {
    if (!cart.size) return; const t = totals(); if (t.net < minOrder) { toast('لم يتحقق الحد الأدنى للطلب'); return; } closeCart(); const sv = LS.get('cust', {}); const d = $('#cdlg');
    d.innerHTML = `<div class="dh"><h3>إتمام الطلب</h3><button class="ib" data-act="close-dlg" aria-label="إغلاق">${ic('x')}</button></div><div class="dbody"><div id="ce"></div><div class="fg">
      <div class="f2"><label class="fl">الاسم الكامل<input id="cn" autocomplete="name" value="${esc(sv.name || '')}" required></label><label class="fl">رقم الجوال<input id="cp" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="05xxxxxxxx" value="${esc(sv.phone || '')}" required></label></div>
      <div class="f2"><label class="fl">المدينة<input id="cc2" autocomplete="address-level2" value="${esc(sv.city || '')}"></label><label class="fl">العنوان التفصيلي (الحي، الشارع، رقم المبنى)<textarea id="ca" rows="2" autocomplete="street-address" required>${esc(sv.address || '')}</textarea></label></div>
      <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:700;margin-bottom:6px">طريقة الدفع</legend><div class="pay">${site.payment_methods.map((m, i) => `<label><input type="radio" name="pm" value="${esc(m)}" ${i === 0 ? 'checked' : ''}>${esc(PAY[m] || m)}</label>`).join('')}</div></fieldset>
      <label class="fl">ملاحظات (اختياري)<textarea id="cnt3" rows="2" maxlength="500"></textarea></label>
      <div class="tot" style="background:var(--c-l);border-radius:14px;padding:12px">${[...cart].map(([id, q]) => `<div><span>${esc(byId.get(id).name_ar)} × ${q}</span><span class="n">${money(q * byId.get(id).price)}</span></div>`).join('')}${hasDelivery ? `<div><span>التوصيل</span><span class="n">${t.dfee ? money(r2(t.dfee + t.dvat)) : 'مجاني'}</span></div>` : ''}<div class="g"><span>الإجمالي (تقديري)</span><span class="n">${money(t.total)} ر.س</span></div></div>
      <button class="btn block" id="sub" data-act="submit">تأكيد الطلب</button></div></div>`;
    d.showModal();
  }
  async function submitOrder() {
    const E = $('#ce'), btn = $('#sub'); E.innerHTML = ''; const v = id => $(id).value.trim(); const phone = digits(v('#cp'));
    const errs = []; const mark = (id, bad) => $(id).setAttribute('aria-invalid', bad ? 'true' : 'false');
    mark('#cn', v('#cn').length < 2); mark('#cp', !/^\+?[0-9]{9,14}$/.test(phone)); mark('#ca', v('#ca').length < 3);
    if (v('#cn').length < 2) errs.push('أدخل الاسم الكامل'); if (!/^\+?[0-9]{9,14}$/.test(phone)) errs.push('رقم الجوال غير صحيح (مثال: 05xxxxxxxx)'); if (v('#ca').length < 3) errs.push('أدخل العنوان');
    if (errs.length) { E.innerHTML = `<div class="msg err" role="alert">${errs.map(esc).join('<br>')}</div>`; return; }
    btn.disabled = true; const pm = $('#cdlg input[name=pm]:checked')?.value;
    let res; try { res = await fetch('/api/public/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: store.slug, payment: pm, notes: v('#cnt3'), customer: { name: v('#cn'), phone, city: v('#cc2'), address: v('#ca') }, lines: [...cart].map(([product_id, qty]) => ({ product_id, qty })) }) }); }
    catch { E.innerHTML = '<div class="msg err" role="alert">تعذّر الاتصال بالخادم، حاول مرة أخرى</div>'; btn.disabled = false; return; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { E.innerHTML = `<div class="msg err" role="alert">${esc(res.status === 429 ? 'محاولات كثيرة، حاول بعد قليل' : (j.error || 'تعذّر إرسال الطلب').replace(/^ERPX-[A-Z]\d+:\s*/, ''))}</div>`; btn.disabled = false; return; }
    LS.set('cust', { name: v('#cn'), phone, city: v('#cc2'), address: v('#ca') }); cart.clear(); saveCart(); drawBadges(); drawList();
    const wa = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(`مرحباً، أرسلت الطلب رقم ${j.number} بإجمالي ${money(j.total)} ر.س`)}` : '';
    $('#cdlg').innerHTML = `<div class="dbody"><div class="done"><div class="ck">${ic('check')}</div><h2>تم استلام طلبك</h2><p>رقم الطلب <b class="n">${esc(j.number)}</b></p><p>الإجمالي <b class="n">${money(j.total)}</b> ر.س شامل الضريبة والتوصيل. سنتواصل معك للتأكيد.</p><p class="vt">احتفظ برقم الطلب للمراجعة.</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">${ic('chat')} تأكيد عبر واتساب</a>` : ''}<button class="btn ghost" data-act="close-dlg">متابعة التسوق</button></div></div></div>`;
  }

  // ---------- booking (services / rentals) — geo cascade from the public API ----------
  let geo = window.__geo;
  const syncBook = () => { const p = byId.get(+$('#bk')?.value); const b = $('#bkb'); if (b && p) b.textContent = p.kind === 'rental' ? 'احجز التأجير' : 'احجز موعد فني'; };
  $('#bk')?.addEventListener('change', syncBook); syncBook();
  const fill = (el, items, ph) => { el.innerHTML = `<option value="">${ph}</option>` + items.map(i => `<option value="${esc(i.name_ar)}" data-id="${i.id}">${esc(i.name_ar)}</option>`).join(''); };
  // ---- product add-ons of a service request: optional, in-stock goods only; the DATABASE re-checks stock and prices (place_booking, ERPX-K028) ----
  const addonList = () => goods.filter(p => p.in_stock);
  const addonsHtml = () => { const a = addonList(); if (!a.length) return '';
    return `<div class="addons"><b>أضف منتجات إلى طلبك <small>(اختياري — بحد أقصى 9 أصناف)</small></b><div class="adl">${a.map(p => `<div class="ad"><span class="adn">${esc(p.name_ar)}<small>${money(p.price)} ر.س شامل الضريبة${p.max <= 5 ? ' · آخر ' + p.max + ' قطع' : ''}</small></span><span class="adq"><button type="button" class="ib sm" data-act="ad-dec" data-id="${p.id}" aria-label="إنقاص ${esc(p.name_ar)}">−</button><input class="n" type="number" inputmode="numeric" min="0" max="${p.max}" value="0" data-addon="${p.id}" aria-label="كمية ${esc(p.name_ar)}"><button type="button" class="ib sm" data-act="ad-inc" data-id="${p.id}" aria-label="زيادة ${esc(p.name_ar)}">+</button></span></div>`).join('')}</div><p class="vt" id="adsum" aria-live="polite"></p></div>`; };
  const addonLines = () => [...document.querySelectorAll('#bdlg [data-addon]')].map(i => ({ product_id: +i.dataset.addon, qty: Math.min(Math.max(0, Math.floor(+i.value || 0)), +i.max || 99) })).filter(l => l.qty > 0);
  const syncAddons = () => { const el = $('#adsum'); if (!el) return; const L = addonLines(); const tot = L.reduce((t, l) => t + (byId.get(l.product_id)?.price || 0) * l.qty, 0);
    el.classList.toggle('err', L.length > 9);
    el.textContent = L.length > 9 ? 'الحد الأقصى 9 أصناف من المنتجات في الطلب الواحد' : L.length ? `المنتجات المضافة: ${L.length} صنف — ${money(tot)} ر.س شامل الضريبة (تُحسب نهائياً عند التأكيد)` : ''; };
  const stepAddon = (id, d) => { const i = document.querySelector(`#bdlg [data-addon="${id}"]`); if (!i) return; i.value = Math.min(+i.max || 99, Math.max(0, (+i.value || 0) + d)); syncAddons(); };
  async function openBooking(id) {
    if (!geo) { try { const g = await fetch('/api/public/geo'); if (!g.ok) throw 0; geo = window.__geo = await g.json(); } catch { toast('تعذّر تحميل المناطق والمدن، حاول مرة أخرى'); return; } }
    const ksa = n => new Date(Date.now() + 3 * 3600e3 + n * 86400e3).toISOString().slice(0, 10); const tm = []; for (let h = 8; h <= 20; h++) for (const m of ['00', '30']) { if (h === 20 && m === '30') { tm.push('20:30'); continue; } tm.push(String(h).padStart(2, '0') + ':' + m); }
    const d = $('#bdlg'); closeDlg($('#pdlg'));
    d.innerHTML = `<div class="dh"><h3>طلب خدمة / حجز</h3><button class="ib" data-act="close-dlg" aria-label="إغلاق">${ic('x')}</button></div><div class="dbody"><div id="be"></div><div class="fg">
      <div class="f2"><label class="fl">الخدمة<select id="bs">${bookable.map(p => `<option value="${p.id}" ${p.id === id ? 'selected' : ''}>${esc(p.name_ar)} — ${money(p.price)} ر.س</option>`).join('')}</select></label><label class="fl">العدد / الأيام<input id="bq" type="number" min="1" max="60" value="1"></label></div>
      ${addonsHtml()}
      <div class="f2"><label class="fl">المنطقة الإدارية<select id="br"></select></label><label class="fl">المدينة<select id="bc"></select></label></div>
      <div class="f2"><label class="fl">الحي<select id="bd"></select></label><label class="fl">الشارع<input id="bst"></label></div>
      <div class="f2"><label class="fl">رقم المبنى<input id="bbn" inputmode="numeric"></label><label class="fl">الرمز البريدي<input id="bpc" inputmode="numeric"></label></div>
      <label class="fl">وصف مختصر للموقع<input id="ban"></label>
      <div class="f2"><label class="fl">التاريخ<input id="bdt" type="date" min="${ksa(0)}" value="${ksa(1)}"></label><label class="fl">الوقت<select id="btm">${tm.map(t => `<option>${t}</option>`).join('')}</select></label></div>
      <div class="f2"><label class="fl">الاسم<input id="bnm" autocomplete="name" value="${esc(LS.get('cust', {}).name || '')}"></label><label class="fl">الجوال<input id="bph" inputmode="tel" dir="ltr" placeholder="05xxxxxxxx" value="${esc(LS.get('cust', {}).phone || '')}"></label></div>
      <label class="fl">ملاحظات<textarea id="bnt" rows="2"></textarea></label>
      <p class="vt">السعر شامل الضريبة يُحسب عند التأكيد. سيتواصل معك فريقنا لتأكيد الموعد وإسناد الفني.</p><button class="btn block" id="bsub" data-act="book-submit">تأكيد الحجز</button></div></div>`;
    fill($('#br'), geo.regions, 'اختر المنطقة'); fill($('#bc'), [], 'اختر المدينة'); fill($('#bd'), [], 'اختر الحي');
    $('#br').onchange = e => { const rid = +e.target.selectedOptions[0]?.dataset.id; fill($('#bc'), geo.cities.filter(c => c.region_id === rid), 'اختر المدينة'); fill($('#bd'), [], 'اختر الحي'); };
    $('#bc').onchange = e => { const cid = +e.target.selectedOptions[0]?.dataset.id; fill($('#bd'), geo.districts.filter(x => x.city_id === cid), 'اختر الحي'); };
    d.querySelectorAll('[data-addon]').forEach(i => i.addEventListener('input', syncAddons));
    d.showModal();
  }
  async function submitBooking() {
    const btn = $('#bsub'), E = $('#be'); btn.disabled = true; E.innerHTML = ''; const v = id => $(id).value; const phone = digits(v('#bph'));
    const extra = addonLines(); if (extra.length > 9) { E.innerHTML = '<div class="msg err" role="alert">الحد الأقصى 9 أصناف من المنتجات في الطلب الواحد</div>'; btn.disabled = false; return; }
    let res; try { res = await fetch('/api/public/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: store.slug, customer: { name: v('#bnm'), phone, region: v('#br'), city: v('#bc'), district: v('#bd'), street: v('#bst'), building_no: v('#bbn'), postal_code: v('#bpc'), address_notes: v('#ban'), notes: v('#bnt') }, when: { date: v('#bdt'), time: v('#btm') }, lines: [{ product_id: +v('#bs'), qty: +v('#bq') }, ...extra] }) }); }
    catch { E.innerHTML = '<div class="msg err" role="alert">تعذّر الاتصال بالخادم، حاول مرة أخرى</div>'; btn.disabled = false; return; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { E.innerHTML = `<div class="msg err" role="alert">${esc(res.status === 429 ? 'محاولات كثيرة، حاول بعد قليل' : (j.error || 'تعذّر إرسال الحجز').replace(/^ERPX-[A-Z]\d+:\s*/, ''))}</div>`; btn.disabled = false; return; }
    $('#bdlg').innerHTML = `<div class="dbody"><div class="done"><div class="ck">${ic('check')}</div><h2>تم استلام حجزك</h2><p>رقم الحجز <b class="n">${esc(j.number)}</b></p><p>الإجمالي <b class="n">${money(j.total)}</b> ر.س شامل الضريبة. سنتواصل معك لتأكيد الموعد وإسناد الفني.</p><button class="btn" data-act="close-dlg">حسناً</button></div></div>`;
  }

  // ---------- events (single delegated handler; no inline handlers, CSP-safe) ----------
  const closeDlg = d => { if (d?.open) d.close(); };
  root.addEventListener('click', e => {
    const chip = e.target.closest('[data-cat]'); if (chip) { S.cat = chip.dataset.cat; S.shown = 24; drawChips(); drawList(); return; }
    const t = e.target.closest('[data-act]'); if (!t) { if (e.target.tagName === 'DIALOG') closeDlg(e.target); return; } const id = +t.dataset.id;
    switch (t.dataset.act) {
      case 'open': openProduct(id); break; case 'add': addToCart(id); break; case 'inc': setQty(id, (cart.get(id) || 0) + 1); break; case 'dec': setQty(id, (cart.get(id) || 0) - 1); break; case 'rm': setQty(id, 0); break;
      case 'add-qty': { const n = Math.max(1, parseInt($('#pq').value) || 1); addToCart(id, n); break; } case 'wish': toggleWish(id); if ($('#pdlg').open) drawProduct(+$('#pdlg').dataset.id, true); break;
      case 'copy': navigator.clipboard?.writeText(location.origin + location.pathname + '#p' + id).then(() => toast('نُسخ الرابط'), () => toast(location.href)); break;
      case 'close-cart': closeCart(); break; case 'checkout': openCheckout(); break; case 'submit': submitOrder(); break; case 'book': openBooking(id); break; case 'book-submit': submitBooking(); break;
      case 'close-dlg': closeDlg(t.closest('dialog')); break;
      case 'reset': Object.assign(S, { q: '', cat: 'all', stock: false, off: false, wish: false, shown: 24 }); $('#q').value = ''; $('#st').checked = $('#of').checked = false; drawChips(); drawList(); break;
      case 'pick-svc': { closeDlg($('#pdlg')); const sel = $('#bk'); if (sel) { sel.value = String(id); syncBook(); } const sec = document.getElementById('bookings'); sec?.scrollIntoView({ behavior: 'smooth' }); const bx = $('#bkbox'); bx?.classList.add('flash'); setTimeout(() => bx?.classList.remove('flash'), 1600); break; }
      case 'book-sel': openBooking(+$('#bk').value); break;
      case 'ad-inc': stepAddon(id, 1); break; case 'ad-dec': stepAddon(id, -1); break;
    }
  });
  $('#cb').onclick = openCart; $('#barb').onclick = openCart; $('#ov').onclick = closeCart;
  $('#wb').onclick = () => { S.wish = !S.wish; S.shown = 24; drawList(); $('#wb').style.background = S.wish ? 'var(--c-l)' : ''; document.getElementById('list').scrollIntoView({ behavior: 'smooth' }); };
  $('#so').onchange = e => { S.sort = e.target.value; drawList(); }; $('#st').onchange = e => { S.stock = e.target.checked; drawList(); }; $('#of').onchange = e => { S.off = e.target.checked; drawList(); };
  $('#more').onclick = () => { S.shown += 24; drawList(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCart(); $('#sg').hidden = true; } });
  // search with suggestions
  let tmr; const sg = $('#sg'); $('#q').addEventListener('input', e => { clearTimeout(tmr); tmr = setTimeout(() => { S.q = e.target.value; S.shown = 24; drawList(); const q = norm(S.q.trim());
    const m = q.length >= 2 ? P.filter(p => norm(p.name_ar).includes(q)).slice(0, 6) : []; sg.hidden = !m.length; sg.innerHTML = m.map(p => `<li><button data-sg="${p.id}">${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="th ph" style="font-size:22px">${emoji(p)}</span>`}<span>${esc(p.name_ar)}<br><b class="n">${money(p.price)} ر.س</b></span></button></li>`).join(''); }, 150); });
  sg.addEventListener('click', e => { const b = e.target.closest('[data-sg]'); if (b) { sg.hidden = true; openProduct(+b.dataset.sg); } });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { sg.hidden = true; document.getElementById('list').scrollIntoView({ behavior: 'smooth' }); } });
  document.addEventListener('click', e => { if (!e.target.closest('.srch')) sg.hidden = true; });

  root.addEventListener('error', e => { const t = e.target; if (t?.tagName === 'IMG' && !t.dataset.f) { t.dataset.f = '1'; const p = document.createElement('div'); p.className = t.closest('.ci') ? 'th' : 'ph'; p.textContent = '🖼️'; t.replaceWith(p); } }, true);   // broken image -> placeholder (inline onerror is blocked by CSP)
  const hh = () => document.documentElement.style.setProperty('--hh', ($('header.top')?.offsetHeight || 64) + 'px'); hh(); addEventListener('resize', hh);
  drawChips(); drawList(); drawBadges();
  const h = /^#p(\d+)$/.exec(location.hash); if (h) openProduct(+h[1]);
})();
