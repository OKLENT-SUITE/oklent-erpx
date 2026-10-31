// Commerce / store / admin screens. Installed into VIEWS by app.js. https://oklent.net/
export function installCommerce(VIEWS, X) {
  const { api, esc, money, today, head, foot, table, num, tag, guard, toast, $, done, csv, printDoc } = X;
  const me = () => X.getMe();
  const can = (...r) => r.includes(me().role);
  const ST = { new: ['closed', 'جديد'], confirmed: ['asset', 'مؤكد'], fulfilled: ['open', 'مُسلَّم'], cancelled: ['locked', 'ملغى'], pending: ['closed', 'معلّقة'], matched: ['open', 'مطابقة'], rejected: ['locked', 'مرفوضة'] };
  const st = s => tag(...(ST[s] || ['asset', s]));
  const PAY = { cod: 'الدفع عند الاستلام', bank_transfer: 'حوالة بنكية', mada: 'مدى', card: 'بطاقة' };
  const printInvoice = async id => { const r = await fetch(`/api/invoices/${id}/print`, { headers: { authorization: 'Bearer ' + X.token() } }); const w = open('', '_blank'); w.document.write(await r.text()); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 400); };
  // compact modern stat cards (icon chip + label + value); colours: teal / violet / amber / blue / green / coral
  const stat = (cls, ic, label, value, unit = '') => `<div class="stat s-${cls}"><span class="si">${X.icon ? X.icon(ic, 17) : ''}</span><span class="sx"><span class="sl">${label}</span><b class="sv n">${value}${unit ? `<small> ${unit}</small>` : ''}</b></span></div>`;
  const stockStats = (t, extra = '') => `<div class="stat-strip">${stat('teal', 'tag', 'أصناف متتبَّعة', t.items)}${stat('blue', 'boxes', 'إجمالي الكميات بالمخزون', Number(t.total_qty).toLocaleString('en-US'))}${stat('green', 'coins', 'إجمالي قيمة المخزون (متوسط التكلفة)', money(t.total_value), 'ر.س')}${stat('amber', 'clock', 'منخفض (5 أو أقل)', t.low_stock)}${stat('violet', 'lock', 'نفد المتاح', t.out_of_stock)}${extra}</div>`;
  const tabs = (m, items, cur, go) => { m.querySelector('.tabs').innerHTML = items.map(([k, l]) => `<button data-t="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join(''); m.querySelectorAll('.tabs button').forEach(b => b.onclick = () => go(b.dataset.t)); };
  const planned = (title, sub, items) => async m => { m.innerHTML = head(title, sub) + `<div class="card planned"><b>⚠ هذه الشاشة مخطَّطة وغير مفعّلة بعد</b><p>تتطلب محرك مخزون كاملاً (حركات مخزنية، تقييم FIFO/AVCO/التكلفة المعيارية، ربط مع قيود تكلفة البضاعة 5100 والمخزون 1140). لن أعرض أرقاماً وهمية.</p>
    <b>النطاق المخطَّط:</b><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul><p class="sub">المبدأ: لا حركة مخزون بلا أثر محاسبي قابل للتتبع، والمخزون يُقاس بالحركات لا بحقل رصيد قابل للتعديل.</p></div>`; done(m); };

  // ---- product images: pick from device -> preview -> validate -> upload (stored on the persistent volume, path saved in products.image_url) ----
  const IMG_OK = ['image/jpeg', 'image/png', 'image/webp'], IMG_MAX = 2 * 1024 * 1024;
  const imgCheck = f => !f ? '' : !IMG_OK.includes(f.type) ? 'نوع الملف غير مدعوم: المسموح JPG أو PNG أو WebP فقط' : f.size === 0 ? 'الملف فارغ' : f.size > IMG_MAX ? `حجم الصورة ${(f.size / 1048576).toFixed(1)} ميجابايت يتجاوز الحد (2 ميجابايت)` : '';
  const uploadImage = async (id, file) => { const r = await fetch(`/api/products/${id}/image`, { method: 'POST', headers: { authorization: 'Bearer ' + X.token(), 'content-type': file.type }, body: file });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(r.status === 413 ? 'حجم الصورة يتجاوز 2 ميجابايت' : j.error || 'تعذّر رفع الصورة'); return j; };
  if (!document.__imgFallback) { document.__imgFallback = true; document.addEventListener('error', e => { const t = e.target; if (t?.tagName === 'IMG' && t.classList.contains('pthumb')) { const s = document.createElement('span'); s.className = t.className + ' ph'; s.title = 'تعذّر تحميل الصورة — تحقق من مسارها'; s.textContent = '⚠'; t.replaceWith(s); } }, true); }   // CSP forbids inline onerror, so one capture listener handles every thumbnail
  const thumb = (u, cls = '') => u ? `<img class="pthumb ${cls}" src="${esc(u)}" alt="" loading="lazy">` : `<span class="pthumb ph ${cls}">🖼</span>`;
  // wires a file input + preview box; returns { file(), clear() }. Preview is a local blob: URL (nothing is uploaded until the user saves).
  function imagePicker(root, { input, preview, msg, clearBtn, pick }) {
    let url = null, file = null; const ph = preview.innerHTML;
    const reset = () => { if (url) URL.revokeObjectURL(url); url = null; file = null; input.value = ''; preview.innerHTML = ph; msg.textContent = 'JPG / PNG / WebP — حتى 2 ميجابايت'; msg.className = 'sub'; clearBtn.hidden = true; root.dispatchEvent(new CustomEvent('imgchange')); };
    pick.onclick = () => input.click(); clearBtn.onclick = reset;
    input.onchange = () => { const f = input.files[0]; if (!f) return; const err = imgCheck(f); if (err) { reset(); msg.textContent = '⚠ ' + err; msg.className = 'sub imgerr'; return; }
      if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(f); file = f; preview.innerHTML = `<img src="${url}" alt="معاينة">`; msg.textContent = `${f.name} — ${(f.size / 1024).toFixed(0)} كيلوبايت (معاينة قبل الحفظ)`; msg.className = 'sub'; clearBtn.hidden = false; root.dispatchEvent(new CustomEvent('imgchange')); };
    return { file: () => file, clear: reset };
  }
  function imageDialog(p, done) {
    const d = document.createElement('dialog'); d.className = 'imgdlg';
    d.innerHTML = `<h3>صورة المنتج: ${esc(p.name_ar)}</h3><div class="imgpick"><div class="imgprev" id="dp">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : '🖼'}</div><div><input type="file" id="df" accept="image/jpeg,image/png,image/webp" hidden>
      <button type="button" class="btn teal sm" id="db">اختيار صورة من الجهاز</button> <button type="button" class="btn ghost sm" id="dx" hidden>تراجع عن الاختيار</button><div class="sub" id="dm"></div></div></div>
      <div class="row" style="margin:14px 0 0"><button class="btn teal" id="ds" disabled>حفظ الصورة</button>${p.image_url ? '<button class="btn coral" id="dr">حذف الصورة</button>' : ''}<button class="btn ghost" id="dc">إلغاء</button></div>`;
    document.body.appendChild(d); const q = s => d.querySelector(s); const pk = imagePicker(d, { input: q('#df'), preview: q('#dp'), msg: q('#dm'), clearBtn: q('#dx'), pick: q('#db') });
    if (p.image_url) q('#dp').innerHTML = `<img src="${esc(p.image_url)}" alt="">`;
    d.addEventListener('imgchange', () => { q('#ds').disabled = !pk.file(); if (!pk.file() && p.image_url) q('#dp').innerHTML = `<img src="${esc(p.image_url)}" alt="">`; });
    const close = () => { pk.clear(); d.close(); d.remove(); };
    q('#dc').onclick = close; d.addEventListener('cancel', () => { pk.clear(); d.remove(); });
    q('#ds').onclick = guard(async () => { q('#ds').disabled = true; try { await uploadImage(p.id, pk.file()); } catch (e) { q('#ds').disabled = false; throw e; } toast('حُفظت الصورة'); close(); done(); });
    q('#dr')?.addEventListener('click', guard(async () => { if (!confirm('حذف صورة هذا المنتج؟')) return; await api(`/products/${p.id}/image`, { method: 'DELETE' }); toast('حُذفت الصورة'); close(); done(); }));
    d.showModal();
  }

  // ================= المنتجات والعروض =================
  // المنتجات (في المخزون) والعروض (في المبيعات) شاشتان منفصلتان تتشاركان نفس المنشئ ومعرّفات DOM
  const catalog = async (m, tab) => {
    const [prods, offers, tc] = await Promise.all([api('/products'), api('/offers'), api('/tax-codes')]); const ed = can('admin', 'accountant');
    const sum = tab === 'products' ? await api('/stock/summary').catch(() => null) : null;
    const unvalued = tab === 'products' && ed ? await api('/stock/unvalued').catch(() => []) : [];
    m.innerHTML = (tab === 'offers' ? head('العروض والخصومات', 'خصم بنسبة أو بمبلغ ثابت على منتج محدد أو على كل المنتجات. الخصم والضريبة يُحسبان في قاعدة البيانات لا في المتصفح. المنتجات نفسها في المخزون ← المنتجات والأصناف.')
      : head('المنتجات والأصناف', 'قائمة الأصناف والخدمات وأسعارها وصورها وتتبّع مخزونها. السعر الظاهر سعر البيع؛ متوسط تكلفة المخزون يُراجع من أرصدة المخزون. العروض والخصومات في المبيعات ← العروض والخصومات.', '<button class="btn" id="pr-prods">🖨️ طباعة المنتجات</button>')) + '<div id="prod-edit-box"></div>' + (sum && sum.items !== undefined ? stockStats(sum) : '') + (unvalued.length ? `<div class="card geo-note noprint"><b>قيمة المخزون غير مكتملة</b><div>يوجد ${unvalued.length} صنفاً برصيد موجب دون متوسط تكلفة موثّق. أسعار البيع في هذه القائمة لا تُستخدم كتكلِفة للمخزون. أدخل تكلفة الشراء من مستندها في شاشة أرصدة المخزون لاستكمال التقييم.</div><button class="btn teal sm" id="open-stock-valuation">مراجعة تكلفة المخزون (${unvalued.length})</button></div>` : '') + '<div id="tb"></div>';
    $('#open-stock-valuation')?.addEventListener('click', () => X.go('stock'));
    if ($('#pr-prods')) $('#pr-prods').onclick = () => printDoc('دليل المنتجات والخدمات والأسعار', table([{ k: 'sku', t: 'الرمز' }, { k: 'name_ar', t: 'اسم المنتج' }, { k: 'category', t: 'التصنيف' }, { ...num('sale_price'), t: 'السعر بدون ضريبة' }, { t: 'النوع', f: r => ({ goods: 'بضاعة', service: 'خدمة', rental: 'تأجير' })[r.kind] }, { t: 'المخزون', f: r => r.stock_tracked ? 'متتبَّع' : 'غير متتبَّع' }], prods), { subtitle: 'قائمة الأصناف والأسعار المعتمدة' });
    const draw = t => {
      $('#tb').innerHTML = t === 'products' ? `<div class="card">${table([{ t: 'الصورة', f: r => thumb(r.image_url) }, { k: 'sku', t: 'الرمز' }, { k: 'name_ar', t: 'الاسم' }, { t: 'النوع', f: r => ({ goods: 'بضاعة', service: 'خدمة', rental: 'تأجير' })[r.kind] }, { k: 'category', t: 'التصنيف' }, { ...num('sale_price'), t: 'السعر بدون ضريبة' }, { ...num('unit_discount'), t: 'الخصم الساري' },
          { t: 'الإيراد', f: r => r.revenue_account }, { t: 'المخزون', f: r => r.kind !== 'goods' ? '—' : r.stock_tracked ? tag('open', 'متتبَّع') : tag('closed', 'غير متتبَّع') }, { t: 'في المتجر', f: r => r.published ? tag('open', 'منشور') : tag('closed', 'مخفي') },
          { t: '', f: r => ed ? `<span class="noprint"><button class="btn ghost sm" data-ed-prod="${r.id}">تعديل</button> <button class="btn ghost sm" data-pub="${r.id}" data-v="${r.published}">${r.published ? 'إخفاء' : 'نشر'}</button> <button class="btn ghost sm" data-img="${r.id}">الصورة</button> <button class="btn ghost sm" data-pr="${r.id}">السعر</button>${r.kind === 'goods' && !r.stock_tracked ? ` <button class="btn teal sm" data-tr="${r.id}">تتبّع المخزون</button>` : ''}</span>` : '' }], prods)}</div>
        ${ed ? `<div class="card noprint"><b>منتج / خدمة جديدة</b><div class="row"><label>الرمز SKU<input id="ps"></label><label style="flex:2">الاسم<input id="pn"></label><label>النوع<select id="pk"><option value="goods">بضاعة (مبيعات الألعاب 4200)</option><option value="rental">تأجير (4100)</option><option value="service">خدمة / صيانة (4300)</option></select></label>
          <label>التصنيف<input id="pc"></label><label>السعر بدون ضريبة<input id="pp" type="number" step="0.01"></label><label>الضريبة<select id="pt">${tc.map(x => `<option value="${x.code}">${esc(x.name_ar)}</option>`).join('')}</select></label>
          <label>تتبّع المخزون (بضاعة فقط)<select id="pst"><option value="0">لا</option><option value="1">نعم</option></select></label><label>تكلفة الوحدة (للافتتاحي)<input id="pcost" type="number" min="0" step="0.01" value="0"></label><label>الكمية الافتتاحية<input id="pq" type="number" min="0" step="1" value="0"></label>
          <button class="btn teal" id="pa">إضافة</button></div>
          <div class="imgpick"><div class="imgprev" id="pip">🖼</div><div><input type="file" id="pif" accept="image/jpeg,image/png,image/webp" hidden><button type="button" class="btn ghost sm" id="pib">اختيار صورة من الجهاز</button> <button type="button" class="btn ghost sm" id="pix" hidden>إزالة</button><div class="sub" id="pim">JPG / PNG / WebP — حتى 2 ميجابايت</div><label style="margin-top:6px">أو رابط صورة خارجي (https) — اختياري<input id="pi" placeholder="https://…"></label></div></div></div>` : ''}` :
        `<div class="card">${table([{ k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'العرض' }, { t: 'المنتج', f: r => esc(r.product || 'كل المنتجات') }, { t: 'الخصم', f: r => r.discount_type === 'percent' ? r.value + '%' : money(r.value) + ' ر.س' }, { k: 'start_date', t: 'من' }, { k: 'end_date', t: 'إلى' },
          { t: 'الحالة', f: r => r.is_active ? tag('open', 'مفعّل') : tag('locked', 'موقوف') }, { t: '', f: r => ed ? `<button class="btn ghost sm noprint" data-of="${r.id}" data-a="${r.is_active}">${r.is_active ? 'إيقاف' : 'تفعيل'}</button>` : '' }], offers)}</div>
        ${ed ? `<div class="card noprint"><b>عرض جديد</b><div class="row"><label>الرمز<input id="oc"></label><label style="flex:2">الاسم<input id="on"></label><label>المنتج<select id="op"><option value="">كل المنتجات</option>${prods.map(p => `<option value="${p.id}">${esc(p.name_ar)}</option>`).join('')}</select></label>
          <label>النوع<select id="ot"><option value="percent">نسبة %</option><option value="amount">مبلغ ثابت للوحدة</option></select></label><label>القيمة<input id="ov" type="number" step="0.01"></label><label>من<input id="os" type="date" value="${today()}"></label><label>إلى<input id="oe" type="date"></label><button class="btn teal" id="oa">إضافة</button></div></div>` : ''}`;
      { const nf = $('#tb > .card.noprint'); if (t === 'products' && nf) m.insertBefore(nf, $('#tb')); }   // «منتج / خدمة جديدة» في أعلى الصفحة
      const reload = () => VIEWS[t === 'offers' ? 'offers' : 'products'](m);
      const pick = $('#pif') ? imagePicker(m, { input: $('#pif'), preview: $('#pip'), msg: $('#pim'), clearBtn: $('#pix'), pick: $('#pib') }) : null;
      $('#pa')?.addEventListener('click', guard(async () => { const file = pick?.file(); const created = await api('/products', { method: 'POST', body: { sku: $('#ps').value, name_ar: $('#pn').value, kind: $('#pk').value, category: $('#pc').value, sale_price: $('#pp').value, tax_code: $('#pt').value, image_url: file ? undefined : ($('#pi').value || undefined), stock_tracked: $('#pk').value === 'goods' && $('#pst').value === '1', opening_qty: $('#pq').value || 0, cost_price: $('#pcost').value || 0 } });
        if (file) { try { await uploadImage(created.id, file); } catch (e) { toast('أُضيف المنتج لكن تعذّر رفع الصورة: ' + e.message + ' — ارفعها من زر «الصورة» في الجدول', false); reload(); return; } }
        toast('تمت الإضافة'); reload(); }));
      m.querySelectorAll('[data-img]').forEach(b => b.onclick = () => imageDialog(prods.find(x => x.id === +b.dataset.img), reload));
      $('#pk')?.addEventListener('change', () => { const g = $('#pk').value === 'goods'; $('#pst').disabled = !g; $('#pq').disabled = !g; if (!g) $('#pst').value = '0'; });
      $('#oa')?.addEventListener('click', guard(async () => { await api('/offers', { method: 'POST', body: { code: $('#oc').value, name_ar: $('#on').value, product_id: $('#op').value || undefined, discount_type: $('#ot').value, value: $('#ov').value, start_date: $('#os').value, end_date: $('#oe').value } }); toast('تمت الإضافة'); reload(); }));
      m.querySelectorAll('[data-pub]').forEach(b => b.onclick = guard(async () => { await api('/products/' + b.dataset.pub, { method: 'PUT', body: { published: b.dataset.v !== 'true' } }); reload(); }));
      m.querySelectorAll('[data-tr]').forEach(b => b.onclick = guard(async () => { const q = prompt('الكمية الافتتاحية الموجودة فعلاً (0 إن لم يوجد رصيد):', '0'); if (q === null) return; await api('/products/' + b.dataset.tr, { method: 'PUT', body: { stock_tracked: true, opening_qty: q } }); toast('أصبح المنتج يتتبّع المخزون'); reload(); }));
      m.querySelectorAll('[data-pr]').forEach(b => b.onclick = guard(async () => { const v = prompt('السعر الجديد بدون ضريبة:'); if (!v) return; await api('/products/' + b.dataset.pr, { method: 'PUT', body: { sale_price: v } }); reload(); }));
      m.querySelectorAll('[data-of]').forEach(b => b.onclick = guard(async () => { await api('/offers/' + b.dataset.of, { method: 'PUT', body: { is_active: b.dataset.a !== 'true' } }); reload(); }));
      m.querySelectorAll('[data-ed-prod]').forEach(b => b.onclick = () => {
        const p = prods.find(x => x.id === +b.dataset.edProd); if (!p) return;
        $('#prod-edit-box').innerHTML = `<div class="card noprint"><b>تعديل المنتج / الخدمة: ${esc(p.name_ar)} (${esc(p.sku)})</b>
          <div class="row">
            <label style="flex:2">الاسم<input id="med-n" value="${esc(p.name_ar)}"></label>
            <label>التصنيف<input id="med-c" value="${esc(p.category || '')}"></label>
            <label>السعر بدون ضريبة<input id="med-p" type="number" step="0.01" value="${p.sale_price}"></label>
            <label>تتبّع المخزون<select id="med-st"><option value="false" ${!p.stock_tracked ? 'selected' : ''}>لا</option><option value="true" ${p.stock_tracked ? 'selected' : ''}>نعم</option></select></label>
            <label>الحالة في المتجر<select id="med-pub"><option value="true" ${p.published ? 'selected' : ''}>منشور</option><option value="false" ${!p.published ? 'selected' : ''}>مخفي</option></select></label>
            <button class="btn teal" id="med-save">حفظ التعديلات</button>
            <button class="btn ghost" id="med-cancel">إلغاء</button>
          </div></div>`;
        $('#med-cancel').onclick = () => { $('#prod-edit-box').innerHTML = ''; };
        $('#med-save').onclick = guard(async () => {
          await api('/products/' + p.id, {
            method: 'PUT',
            body: {
              name_ar: $('#med-n').value,
              category: $('#med-c').value,
              sale_price: $('#med-p').value,
              stock_tracked: $('#med-st').value === 'true',
              published: $('#med-pub').value === 'true'
            }
          });
          toast('تم تعديل المنتج'); reload();
        });
        $('#prod-edit-box').scrollIntoView?.({ behavior: 'smooth' });
      });
    };
    draw(tab); done(m);
  };
  VIEWS.products = m => catalog(m, 'products');
  VIEWS.offers = m => catalog(m, 'offers');

  // ================= الحوالات =================
  VIEWS.transfers = async function (m) {
    const [tr, pt] = await Promise.all([api('/transfers'), api('/partners')]); const ed = can('admin', 'accountant');
    m.innerHTML = head('الحوالات البنكية', 'سجّل الحوالة الواردة ثم طابقها مع فاتورة: يُنشأ قيد القبض تلقائياً ولا يُسمح بدفع أكثر من المتبقي.', '<button class="btn" id="pr-tr">🖨️ طباعة الحوالات</button>') +
      `<div class="card">${table([{ k: 'transfer_date', t: 'التاريخ' }, { k: 'reference', t: 'المرجع' }, { k: 'partner', t: 'العميل' }, num('amount'), { t: 'الحالة', f: r => st(r.status) }, { t: 'الفاتورة', f: r => esc(r.invoice_no || '') },
        { t: '', f: r => r.status === 'pending' && ed ? `<span class="noprint"><button class="btn teal sm" data-m="${r.id}">مطابقة</button> <button class="btn coral sm" data-r="${r.id}">رفض</button></span>` : '' }], tr)}</div>
      <div id="cand"></div><div class="card noprint"><b>تسجيل حوالة واردة</b><div class="row"><label>المرجع / رقم العملية<input id="tr"></label><label>التاريخ<input type="date" id="td" value="${today()}"></label><label>المبلغ<input type="number" step="0.01" id="ta"></label>
      <label>العميل<select id="tp"><option value="">—</option>${pt.map(p => `<option value="${p.id}">${esc(p.name_ar)}</option>`).join('')}</select></label><label>حساب البنك<select id="tb"><option value="1121">1121 البنك الأهلي</option><option value="1122">1122 مدى/بطاقات</option></select></label><button class="btn teal" id="ts">تسجيل</button></div></div>`;
    $('#pr-tr').onclick = () => printDoc('سجل الحوالات البنكية الواردة', table([{ k: 'transfer_date', t: 'التاريخ' }, { k: 'reference', t: 'المرجع' }, { k: 'partner', t: 'العميل' }, num('amount', 'المبلغ'), { t: 'الحالة', f: r => (ST[r.status] ? ST[r.status][1] : r.status) }, { k: 'invoice_no', t: 'الفاتورة' }], tr), { subtitle: 'سجل الحوالات والمطابقات البنكية' });
    $('#ts').onclick = guard(async () => { await api('/transfers', { method: 'POST', body: { reference: $('#tr').value, transfer_date: $('#td').value, amount: $('#ta').value, partner_id: $('#tp').value || undefined, bank_account: $('#tb').value } }); toast('سُجّلت'); VIEWS.transfers(m); });
    m.querySelectorAll('[data-m]').forEach(b => b.onclick = guard(async () => { const c = await api(`/transfers/${b.dataset.m}/candidates`);
      $('#cand').innerHTML = `<div class="card"><b>اختر الفاتورة المطابقة</b>${table([{ k: 'number', t: 'الفاتورة' }, { k: 'partner', t: 'العميل' }, num('outstanding'), { t: '', f: r => `<button class="btn amber sm" data-i="${r.id}">اعتماد</button>` }], c)}</div>`;
      $('#cand').querySelectorAll('[data-i]').forEach(x => x.onclick = guard(async () => { await api(`/transfers/${b.dataset.m}/confirm`, { method: 'POST', body: { invoice_id: x.dataset.i } }); toast('تمت المطابقة وسُجّل القبض'); VIEWS.transfers(m); })); }));
    m.querySelectorAll('[data-r]').forEach(b => b.onclick = guard(async () => { const r = prompt('سبب الرفض:'); if (!r) return; await api(`/transfers/${b.dataset.r}/reject`, { method: 'POST', body: { reason: r } }); VIEWS.transfers(m); })); done(m);
  };

  // ================= البيع الإلكتروني =================
  VIEWS.orders = async function (m) {
    const [orders, stores] = await Promise.all([api('/orders'), api('/stores')]); const ed = can('admin', 'accountant'), cs = can('admin', 'accountant', 'cashier');
    m.innerHTML = head('البيع الإلكتروني', 'طلبات المتجر العام. المبالغ مجمّدة بعد الطلب؛ الفوترة تُنشئ فاتورة ZATCA وقيداً محاسبياً.', '<button class="btn" id="pr-orders">🖨️ طباعة قائمة الطلبات</button>') +
      `<div class="card noprint"><b>روابط المتاجر</b><p>${stores.filter(s => s.features.includes('online_shop')).map(s => `<a href="/shop/${s.slug}" target="_blank" class="btn ghost sm">${esc(s.name_ar)} ↗ ${s.is_published ? '' : '(غير منشور)'}</a>`).join(' ') || 'لا متجر مفعّل — فعّل «المتجر الإلكتروني» من إعدادات المتجر'}</p></div>
      <div class="card">${table([{ k: 'number', t: 'الطلب' }, { t: 'التاريخ', f: r => r.created_at.slice(0, 10) }, { k: 'customer_name', t: 'العميل' }, { k: 'phone', t: 'الجوال' }, { k: 'city', t: 'المدينة' }, { t: 'الدفع', f: r => PAY[r.payment_method] || r.payment_method }, num('total'), { t: 'الحالة', f: r => st(r.status) }, { k: 'invoice_no', t: 'الفاتورة' },
        { t: '', f: r => `<span class="noprint"><button class="btn ghost sm" data-d="${r.id}">تفاصيل</button> ${cs && r.status === 'new' ? `<button class="btn sm" data-s="confirmed" data-i="${r.id}">تأكيد</button>` : ''}${cs && r.status === 'confirmed' ? `<button class="btn teal sm" data-s="fulfilled" data-i="${r.id}">تسليم</button>` : ''}${cs && ['new', 'confirmed'].includes(r.status) && !r.invoice_id ? `<button class="btn coral sm" data-s="cancelled" data-i="${r.id}">إلغاء</button>` : ''}${ed && !r.invoice_id && r.status !== 'cancelled' ? `<button class="btn amber sm" data-f="${r.id}">فوترة</button>` : ''}</span>` }], orders)}</div><div id="od"></div>`;
    $('#pr-orders').onclick = () => printDoc('سجل طلبات المتجر الإلكتروني', table([{ k: 'number', t: 'الطلب' }, { t: 'التاريخ', f: r => r.created_at.slice(0, 10) }, { k: 'customer_name', t: 'العميل' }, { k: 'phone', t: 'الجوال' }, { k: 'city', t: 'المدينة' }, { t: 'الدفع', f: r => PAY[r.payment_method] || r.payment_method }, num('total', 'المبلغ'), { t: 'الحالة', f: r => (ST[r.status] ? ST[r.status][1] : r.status) }, { k: 'invoice_no', t: 'الفاتورة' }], orders), { subtitle: 'سجل طلبات ومبيعات المتجر الإلكتروني' });
    m.querySelectorAll('[data-s]').forEach(b => b.onclick = guard(async () => { await api(`/orders/${b.dataset.i}/status`, { method: 'POST', body: { status: b.dataset.s } }); VIEWS.orders(m); }));
    m.querySelectorAll('[data-f]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api(`/orders/${b.dataset.f}/invoice`, { method: 'POST' });
        toast('صدرت الفاتورة ' + r.number); VIEWS.orders(m);
      } catch (e) {
        const shortage = String(e.message || '').match(/ERPX-K001: insufficient available stock for (.+?) \(on hand ([\d.]+), reserved by online orders ([\d.]+), requested ([\d.]+)\)/i);
        if (shortage) {
          const [, sku, onHandText, reservedText, requestedText] = shortage;
          const onHand = Number(onHandText), reserved = Number(reservedText), requested = Number(requestedText);
          const needed = Math.max(0, reserved + requested - onHand);
          toast('تعذّر إصدار الفاتورة: المخزون غير كافٍ', false,
            `الصنف ${sku}: بالمخزون ${onHand}، ومحجوز لطلبات أخرى ${reserved}، وكمية هذه الفاتورة ${requested}. يلزم توفير ${needed} وحدة لتغطية الطلبات الحالية. سجّل استلاماً فعلياً للمخزون أو عالج الحجوزات القائمة، ثم أعد المحاولة. لم تُصدر الفاتورة ولم تتغير الكميات.`);
        } else toast('تعذّر إصدار الفاتورة', false, e.message || 'حدث خطأ غير معروف');
      } finally { b.disabled = false; }
    });
    m.querySelectorAll('[data-d]').forEach(b => b.onclick = guard(async () => { const o = await api('/orders/' + b.dataset.d);
      $('#od').innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><b>تفاصيل الطلب: ${esc(o.number)}</b><button class="btn sm noprint" id="pr-ord-slip">🖨️ طباعة إشعار / بوليصة الطلب</button></div>
        <p><b>العميل:</b> ${esc(o.customer_name)} (${esc(o.phone || '')}) · <b>العنوان:</b> ${esc(o.city || '')} - ${esc(o.address || '')} ${o.notes ? '· <b>ملاحظات:</b> ' + esc(o.notes) : ''}</p>
        ${table([{ k: 'description', t: 'البند' }, { k: 'qty', t: 'كمية' }, num('unit_price'), num('discount'), num('net'), num('vat')], o.lines)}<h4 class="n">الإجمالي: ${money(o.total)} ر.س</h4></div>`;
      $('#pr-ord-slip').onclick = () => {
        const oMeta = `
          <div class="p-meta-item"><span class="p-meta-label">رقم الطلب:</span><span class="p-meta-val">${esc(o.number)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">تاريخ الطلب:</span><span class="p-meta-val">${esc(String(o.created_at).slice(0, 16).replace('T', ' '))}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">العميل:</span><span class="p-meta-val">${esc(o.customer_name)} (${esc(o.phone || '')})</span></div>
          <div class="p-meta-item"><span class="p-meta-label">عنوان التوصيل:</span><span class="p-meta-val">${esc(o.city || '')} — ${esc(o.address || '')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">طريقة الدفع:</span><span class="p-meta-val">${esc(PAY[o.payment_method] || o.payment_method)}</span></div>
          ${o.notes ? `<div class="p-meta-item"><span class="p-meta-label">ملاحظات:</span><span class="p-meta-val">${esc(o.notes)}</span></div>` : ''}
        `;
        const oTable = table([{ k: 'description', t: 'البند / المنتج' }, { k: 'qty', t: 'الكمية' }, num('unit_price', 'سعر الوحدة'), num('discount', 'الخصم'), num('net', 'الصافي'), num('vat', 'الضريبة')], o.lines) +
          `<div class="p-total-box"><b>الإجمالي النهائي:</b> ${money(o.total)} ر.س</div>`;
        printDoc(`إشعار طلب وتوصيل (${o.number})`, oTable, {
          ref: o.number,
          meta: oMeta,
          subtitle: 'بوليصة تجهيز وتسليم طلب متجر إلكتروني',
          signatures: [
            { title: 'مسؤول التجهيز والشحن' },
            { title: 'مندوب التوصيل' },
            { title: 'توقيع المستلم' }
          ]
        });
      };
      $('#od').scrollIntoView?.({ behavior: 'smooth' });
    })); done(m);
  };

  // ================= نقاط البيع =================
  VIEWS.pos = async function (m) {
    const [prods, stores] = await Promise.all([api('/products'), api('/stores')]); const ps = stores.filter(s => s.is_active && s.features.includes('pos'));
    if (!ps.length) { m.innerHTML = head('نقاط البيع') + '<div class="card planned">لا يوجد متجر مفعّل فيه «نقاط البيع». فعّلها من الفروع ← إعدادات المتجر.</div>'; return done(m); }
    const cart = new Map(); const items = prods.filter(p => p.is_active && p.kind !== 'rental');
    m.innerHTML = head('نقاط البيع', `الكاشير: <b>${esc(me().username)}</b> — فاتورة ضريبية مبسطة + قبض فوري في معاملة واحدة. الأسعار والعروض من قاعدة البيانات.`) +
      `<div class="pos"><div class="card"><div class="row"><label>الفرع / المتجر<select id="ps">${ps.map(s => `<option value="${s.id}">${esc(s.name_ar)}</option>`).join('')}</select></label><label>بحث<input id="pq" placeholder="اسم أو رمز"></label></div><div class="pgrid" id="pg"></div></div>
       <div class="card"><b>السلة</b> <span class="sub">· الكاشير: ${esc(me().username)}</span><div id="ct"></div><div class="row" style="margin-top:10px"><button class="btn teal" id="pc" style="flex:1">نقداً</button><button class="btn" id="pk" style="flex:1">مدى / بطاقة</button></div><button class="btn ghost sm" id="px">تفريغ</button></div></div>`;
    const drawG = () => { const f = $('#pq').value.trim().toLowerCase(); $('#pg').innerHTML = items.filter(p => !f || (p.name_ar + p.sku).toLowerCase().includes(f)).map(p => `<div class="pcard" data-p="${p.id}">${thumb(p.image_url, 'pimg')}<b>${esc(p.name_ar)}</b><span class="sub">${esc(p.sku)}</span><span class="n">${money(+p.sale_price - +p.unit_discount)} + ض</span>${+p.unit_discount ? tag('open', 'عرض') : ''}</div>`).join('');
      m.querySelectorAll('[data-p]').forEach(c => c.onclick = () => { cart.set(+c.dataset.p, (cart.get(+c.dataset.p) || 0) + 1); drawC(); }); };
    const drawC = () => { let net = 0, vat = 0; const rows = [...cart].map(([id, q]) => { const p = items.find(x => x.id === id); const n = q * (+p.sale_price - +p.unit_discount), v = n * (p.tax_code === 'S15' ? .15 : 0); net += n; vat += v;
        return `<tr><td>${thumb(p.image_url)} ${esc(p.name_ar)}</td><td class="num"><button class="btn ghost sm" data-m="${id}">−</button> ${q} <button class="btn ghost sm" data-a="${id}">+</button></td><td class="num">${money(n + v)}</td></tr>`; }).join('');
      $('#ct').innerHTML = `<table><tbody>${rows || '<tr><td class="sub">السلة فارغة</td></tr>'}</tbody></table><h3 class="n">الإجمالي (تقريبي): ${money(net + vat)} ر.س</h3><div class="sub">المبلغ النهائي تحسبه قاعدة البيانات عند الدفع.</div>`;
      m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { cart.set(+b.dataset.a, cart.get(+b.dataset.a) + 1); drawC(); }); m.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const q = cart.get(+b.dataset.m) - 1; q ? cart.set(+b.dataset.m, q) : cart.delete(+b.dataset.m); drawC(); }); };
    const pay = method => guard(async () => { if (!cart.size) return; const r = await api('/pos/sale', { method: 'POST', body: { store_id: $('#ps').value, method, lines: [...cart].map(([product_id, qty]) => ({ product_id, qty })) } });
      toast(`تمت العملية ${r.number} — ${r.total} ر.س`); cart.clear(); drawC(); printInvoice(r.id); });
    $('#pc').onclick = pay('cash'); $('#pk').onclick = pay('card'); $('#px').onclick = () => { cart.clear(); drawC(); }; $('#pq').oninput = drawG; drawG(); drawC(); done(m);
  };

  // ================= الفواتير والمبيعات (تقارير) =================
  VIEWS.salesrep = async function (m) {
    m.innerHTML = head('تقارير المبيعات', 'ملخص المبيعات وتفاصيل الفواتير بعد احتساب الإشعارات الدائنة', '<button class="btn" id="pr">طباعة / PDF</button> <button class="btn ghost" id="cv-summary">CSV الملخص</button> <button class="btn ghost" id="cv-details">CSV الفواتير</button>') +
      `<div class="card noprint"><div class="row"><label>التجميع<select id="g"><option value="month">الشهر</option><option value="branch">الفرع</option><option value="segment">النشاط (إيجار/ألعاب/صيانة)</option><option value="customer">العميل</option></select></label><label>من<input type="date" id="f" value="${today().slice(0, 4)}-01-01"></label><label>إلى<input type="date" id="t" value="${today()}"></label><button class="btn teal" id="go">عرض</button></div></div><div class="card" id="o"></div>`;
    let rows = [], detailRows = []; const go = guard(async () => { const q = `from=${$('#f').value}&to=${$('#t').value}`; [rows, detailRows] = await Promise.all([api(`/reports/sales?group=${$('#g').value}&${q}`), api(`/reports/sales/details?${q}`)]); rows = rows.map(r => ({ ...r, total: +r.net + +r.vat })); const mx = Math.max(1, ...rows.map(r => +r.net)); const sum = k => rows.reduce((s, r) => s + +r[k], 0); const detailSum = k => detailRows.reduce((s, r) => s + +r[k], 0);
      const kindName = {standard:'ضريبية',simplified:'مبسطة',credit:'إشعار دائن',debit:'إشعار مدين'};
      const summary = table([{ k: 'k', t: 'البند' }, { k: 'invoices', t: 'عدد الفواتير' }, num('net'), num('vat'), num('total', 'الإجمالي شامل الضريبة'), { t: 'مؤشر', f: r => `<div style="background:var(--teal);height:10px;border-radius:5px;width:${Math.max(2, +r.net / mx * 100)}%"></div>` }], rows).replace('</tbody>', `<tr class="tot"><td>الإجمالي</td><td class="num">${detailRows.length}</td><td class="num">${money(sum('net'))}</td><td class="num">${money(sum('vat'))}</td><td class="num">${money(sum('total'))}</td><td></td></tr></tbody>`);
      const details = `<h3>تفاصيل الفواتير</h3>` + table([{ k: 'invoice_no', t: 'رقم الفاتورة' }, { k: 'issue_date', t: 'التاريخ' }, { t: 'النوع', f: r => esc(kindName[r.kind] || r.kind || '—') }, { k: 'customer', t: 'العميل' }, { k: 'branch', t: 'الفرع' }, num('net'), num('vat'), num('total')], detailRows).replace('</tbody>', `<tr class="tot"><td>الإجمالي (${detailRows.length} فاتورة)</td><td colspan="4"></td><td class="num">${money(detailSum('net'))}</td><td class="num">${money(detailSum('vat'))}</td><td class="num">${money(detailSum('total'))}</td></tr></tbody>`);
      $('#o').innerHTML = `<div class="printhead" style="display:block"><b>تقرير المبيعات</b> ${$('#f').value} → ${$('#t').value}</div><h3>ملخص المبيعات حسب ${$('#g').selectedOptions[0].text}</h3>${summary}${details}`; });
    $('#go').onclick = go; $('#g').onchange = go;
    $('#pr').onclick = () => printDoc('تقرير المبيعات والتحليلات', $('#o').innerHTML, { subtitle: `من ${$('#f').value} إلى ${$('#t').value}` });
    $('#cv-summary').onclick = () => rows.length && csv('sales-summary-' + $('#g').value, rows);
    $('#cv-details').onclick = () => detailRows.length && csv('sales-invoices', detailRows); go(); done(m);
  };

  // ================= المصروفات والإيرادات =================
  VIEWS.quick = async function (m) {
    const [acc, br, list, is] = await Promise.all([api('/accounts'), api('/branches'), api('/finance/quick'), api(`/reports/income-statement?from=${today().slice(0, 4)}-01-01&to=${today()}`)]);
    const rev = is.filter(r => r.type === 'revenue').reduce((s, r) => s + +r.amount, 0), exp = is.filter(r => r.type === 'expense').reduce((s, r) => s + +r.amount, 0);
    const opt = t => acc.filter(a => a.type === t && a.is_postable).map(a => `<option value="${a.code}">${a.code} ${esc(a.name_ar)}</option>`).join('');
    m.innerHTML = head('المصروفات والإيرادات', 'وحدة مالية واحدة: كل عملية تُرحَّل بقيد مزدوج متوازن مع ضريبة المدخلات/المخرجات', '<button class="btn" id="pr-quick">🖨️ طباعة العمليات</button>') +
      `<div class="kpis"><div class="kpi">إيرادات السنة<b class="n">${money(rev)}</b></div><div class="kpi">مصروفات السنة<b class="n">${money(exp)}</b></div><div class="kpi">الصافي<b class="n">${money(rev - exp)}</b></div></div>
       ${can('admin', 'accountant') ? `<div class="card noprint"><div class="tabs"></div><div class="row"><label>التاريخ<input type="date" id="qd" value="${today()}"></label><label>الفرع<select id="qb"><option value="">—</option>${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label>
         <label>الحساب<select id="qa"></select></label><label>المبلغ بدون ضريبة<input type="number" step="0.01" id="qm"></label><label>الضريبة<select id="qv"><option value="15">15%</option><option value="0">بدون / معفى</option></select></label>
         <label>${'الدفع/القبض'}<select id="qp"><option value="1110">1110 الصندوق</option><option value="1121">1121 البنك</option><option value="1122">1122 مدى/بطاقات</option></select></label><label style="flex:2">البيان<input id="qn"></label><button class="btn teal" id="qs">ترحيل</button></div></div>` : ''}
       <div class="card">${table([{ k: 'entry_date', t: 'التاريخ' }, { k: 'entry_no', t: 'القيد' }, { t: 'النوع', f: r => r.source_type === 'expense' ? tag('closed', 'مصروف') : tag('open', 'إيراد') }, { k: 'memo', t: 'البيان' }, { k: 'branch', t: 'الفرع' }, num('total_base')], list)}</div>`;
    $('#pr-quick').onclick = () => printDoc('سجل المصروفات والإيرادات', table([{ k: 'entry_date', t: 'التاريخ' }, { k: 'entry_no', t: 'رقم القيد' }, { t: 'النوع', f: r => (r.source_type === 'expense' ? 'مصروف' : 'إيراد') }, { k: 'memo', t: 'البيان' }, { k: 'branch', t: 'الفرع' }, num('total_base', 'المبلغ')], list), { subtitle: 'سجل العمليات المالية المباشرة' });
    if (can('admin', 'accountant')) { let kind = 'expense'; const draw = () => { tabs(m, [['expense', 'مصروف'], ['revenue', 'إيراد آخر']], kind, k => { kind = k; draw(); }); $('#qa').innerHTML = opt(kind); }; draw();
      $('#qs').onclick = guard(async () => { await api('/finance/quick', { method: 'POST', body: { kind, date: $('#qd').value, branch: $('#qb').value || undefined, account: $('#qa').value, amount: $('#qm').value, vat_rate: +$('#qv').value, pay_account: $('#qp').value, memo: $('#qn').value } }); toast('تم الترحيل'); VIEWS.quick(m); }); } done(m);
  };

  // ================= الذمم والمدفوعات =================
  VIEWS.dues = async function (m) {
    const rows = await api('/reports/ar-aging?to=' + today()); const tot = rows.reduce((s, r) => s + +r.outstanding, 0); const ed = can('admin', 'accountant', 'cashier');
    const by = {}; rows.forEach(r => by[r.bucket] = (by[r.bucket] || 0) + +r.outstanding);
    m.innerHTML = head('الذمم والمدفوعات', 'أعمار الذمم المدينة (العملاء) وتحصيلها — ذمم الموردين في المشتريات ← الذمم الدائنة والمدفوعات', '<button class="btn" id="pr">طباعة</button>') + `<div class="kpis"><div class="kpi">إجمالي المستحق<b class="n">${money(tot)}</b></div>${['1-30', '31-60', '61-90', '90+'].map(b => `<div class="kpi">${b} يوم<b class="n">${money(by[b] || 0)}</b></div>`).join('')}</div>
      <div class="card">${table([{ k: 'partner', t: 'العميل' }, { k: 'invoice_no', t: 'الفاتورة' }, { k: 'due_date', t: 'الاستحقاق' }, num('outstanding'), { k: 'bucket', t: 'الفئة' }, { t: '', f: r => ed ? `<button class="btn teal sm noprint" data-pay="${r.invoice_no}" data-o="${r.outstanding}">قبض</button>` : '' }], rows)}</div>`;
    $('#pr').onclick = () => printDoc('أعمار الذمم المدينة للعملاء', table([{ k: 'partner', t: 'العميل' }, { k: 'invoice_no', t: 'الفاتورة' }, { k: 'due_date', t: 'الاستحقاق' }, num('outstanding', 'المتبقي'), { k: 'bucket', t: 'الفئة' }], rows), { subtitle: 'تقرير أعمار الديون والتحصيل' });
    const inv = await api('/invoices?limit=500'); m.querySelectorAll('[data-pay]').forEach(b => b.onclick = guard(async () => { const a = prompt('مبلغ القبض (المتبقي ' + b.dataset.o + '):', b.dataset.o); if (!a) return; const i = inv.find(x => x.number === b.dataset.pay);
      await api(`/invoices/${i.id}/payments`, { method: 'POST', body: { amount: a, cash_account: '1121', method: 'bank' } }); toast('تم القبض'); VIEWS.dues(m); })); done(m);
  };


  // ================= المشتريات =================
  VIEWS.vendors = async function (m) {
    const [v, bills] = await Promise.all([api('/partners?kind=vendor'), api('/bills')]); const ed = can('admin', 'accountant', 'cashier');
    const due = id => bills.filter(b => b.vendor_id === id).reduce((a, b) => a + +b.outstanding, 0);
    m.innerHTML = head('الموردون والذمم الدائنة', 'حساب الذمم الدائنة 2120 — الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3', '<button class="btn" id="pr-vends">🖨️ طباعة قائمة الموردين</button>') +
      `<div id="vend-edit-box"></div>
      <div class="card">${table([
        { k: 'name_ar', t: 'المورد' },
        { k: 'vat_number', t: 'الرقم الضريبي' },
        { k: 'cr_number', t: 'السجل التجاري' },
        { k: 'city', t: 'المدينة' },
        { k: 'phone', t: 'الجوال' },
        { t: 'المستحق له', f: r => `<span class="n">${money(due(r.id))}</span>` },
        { t: '', f: r => ed ? `<span class="noprint"><button class="btn ghost sm" data-ve="${r.id}">تعديل</button></span>` : '' }
      ], v)}</div>
      ${ed ? `<div class="card noprint"><b>مورد جديد</b><div class="row"><label style="flex:2">الاسم<input id="vn"></label><label>الرقم الضريبي<input id="vv" maxlength="15"></label><label>السجل التجاري<input id="vc"></label><label>المدينة<input id="vt"></label><label>الجوال<input id="vp"></label><button class="btn teal" id="vs">إضافة</button></div></div>` : ''}`;
    $('#pr-vends').onclick = () => printDoc('سجل الموردين المعتمدين', table([{ k: 'name_ar', t: 'المورد' }, { k: 'vat_number', t: 'الرقم الضريبي' }, { k: 'cr_number', t: 'السجل التجاري' }, { k: 'city', t: 'المدينة' }, { k: 'phone', t: 'الجوال' }, { t: 'المستحق له', f: r => money(due(r.id)) }], v), { subtitle: 'دليل الموردين والذمم الدائنة' });
    if (ed) {
      $('#vs')?.addEventListener('click', guard(async () => { await api('/partners', { method: 'POST', body: { kind: 'vendor', name_ar: $('#vn').value, vat_number: $('#vv').value, cr_number: $('#vc').value, city: $('#vt').value, phone: $('#vp').value } }); VIEWS.vendors(m); }));
      m.querySelectorAll('[data-ve]').forEach(b => b.onclick = () => {
        const item = v.find(x => x.id === +b.dataset.ve); if (!item) return;
        $('#vend-edit-box').innerHTML = `<div class="card noprint"><b>تعديل بيانات المورد: ${esc(item.name_ar)}</b>
          <div class="row">
            <label style="flex:2">الاسم<input id="ev-n" value="${esc(item.name_ar)}"></label>
            <label>الرقم الضريبي<input id="ev-v" maxlength="15" value="${esc(item.vat_number || '')}"></label>
            <label>السجل التجاري<input id="ev-c" value="${esc(item.cr_number || '')}"></label>
          </div>
          <div class="row">
            <label>المدينة<input id="ev-city" value="${esc(item.city || '')}"></label>
            <label>الجوال<input id="ev-ph" value="${esc(item.phone || '')}"></label>
            <button class="btn teal" id="ev-sv">حفظ التعديلات</button>
            <button class="btn ghost" id="ev-cn">إلغاء</button>
          </div></div>`;
        $('#ev-cn').onclick = () => { $('#vend-edit-box').innerHTML = ''; };
        $('#ev-sv').onclick = guard(async () => {
          await api('/partners/' + item.id, { method: 'PUT', body: { name_ar: $('#ev-n').value, vat_number: $('#ev-v').value || null, cr_number: $('#ev-c').value || null, city: $('#ev-city').value || null, phone: $('#ev-ph').value || null } });
          toast('تم تحديث بيانات المورد'); VIEWS.vendors(m);
        });
        $('#vend-edit-box').scrollIntoView?.({ behavior: 'smooth' });
      });
    }
    done(m);
  };
  VIEWS.bills = async function (m) {
    const [bills, vendors, acc, br] = await Promise.all([api('/bills'), api('/partners?kind=vendor'), api('/accounts'), api('/branches')]); const ed = can('admin', 'accountant');
    const aopt = acc.filter(a => a.is_postable && (a.type === 'expense' || a.code === '1140' || a.code.startsWith('12'))).map(a => `<option value="${a.code}">${a.code} ${esc(a.name_ar)}</option>`).join('');
    m.innerHTML = head('فواتير الموردين', 'قيد: مدين مصروف/مخزون + ضريبة مدخلات 1150 ← دائن موردون 2120. تكرار رقم فاتورة المورد مرفوض.', '<button class="btn" id="pr">طباعة</button>') +
      `<div class="card">${table([{ k: 'number', t: 'الرقم' }, { k: 'supplier_ref', t: 'فاتورة المورد' }, { k: 'vendor', t: 'المورد' }, { k: 'bill_date', t: 'التاريخ' }, { k: 'due_date', t: 'الاستحقاق' }, { t: 'الحساب', f: r => esc(r.account_code + ' ' + r.account_name) }, num('net'), num('vat'), num('total'), num('outstanding'),
        { t: '', f: r => ed && +r.outstanding > 0 ? `<button class="btn teal sm noprint" data-p="${r.id}" data-o="${r.outstanding}">سداد</button>` : '' }], bills)}</div>
      ${ed ? `<div class="card noprint"><b>تسجيل فاتورة مورد</b><div class="row"><label>المورد<select id="bv">${vendors.map(v => `<option value="${v.id}">${esc(v.name_ar)}</option>`).join('')}</select></label><label>رقم فاتورة المورد<input id="br"></label><label>التاريخ<input type="date" id="bd" value="${today()}"></label><label>الاستحقاق<input type="date" id="bu" value="${today()}"></label></div>
        <div class="row"><label>الحساب<select id="ba">${aopt}</select></label><label>المبلغ بدون ضريبة<input type="number" step="0.01" id="bn"></label><label>الضريبة<select id="bt"><option value="15">15%</option><option value="0">بدون / معفى</option></select></label><label>الفرع<select id="bb"><option value="">—</option>${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label><label style="flex:2">البيان<input id="bm"></label><button class="btn teal" id="bs">ترحيل</button></div></div>` : ''}`;
    $('#pr').onclick = () => printDoc('سجل فواتير المشتريات والموردين', table([{ k: 'number', t: 'الرقم' }, { k: 'supplier_ref', t: 'فاتورة المورد' }, { k: 'vendor', t: 'المورد' }, { k: 'bill_date', t: 'التاريخ' }, num('net', 'المبلغ'), num('vat', 'الضريبة'), num('total', 'الإجمالي'), num('outstanding', 'المتبقي')], bills), { subtitle: 'سجل المشتريات وضريبة المدخلات' });
    $('#bs')?.addEventListener('click', guard(async () => { await api('/bills', { method: 'POST', body: { vendor_id: $('#bv').value, supplier_ref: $('#br').value, bill_date: $('#bd').value, due_date: $('#bu').value, account: $('#ba').value, net: $('#bn').value, vat_rate: +$('#bt').value, branch: $('#bb').value || undefined, memo: $('#bm').value } }); toast('رُحّلت الفاتورة'); VIEWS.bills(m); }));
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = guard(async () => { const a = prompt('مبلغ السداد (المتبقي ' + b.dataset.o + '):', b.dataset.o); if (!a) return; await api(`/bills/${b.dataset.p}/payments`, { method: 'POST', body: { amount: a, cash_account: '1121', method: 'bank' } }); toast('تم السداد'); VIEWS.bills(m); })); done(m);
  };
  VIEWS.apay = async function (m) {
    const [rows, bills] = await Promise.all([api('/reports/ap-aging?to=' + today()), api('/bills')]); const ed = can('admin', 'accountant'); const tot = rows.reduce((s, r) => s + +r.outstanding, 0); const by = {}; rows.forEach(r => by[r.bucket] = (by[r.bucket] || 0) + +r.outstanding);
    m.innerHTML = head('الذمم الدائنة والمدفوعات', 'أعمار المستحقات للموردين وسدادها — ذمم العملاء في المالية ← الذمم والمدفوعات', '<button class="btn" id="pr">طباعة</button>') + `<div class="kpis"><div class="kpi">إجمالي المستحق للموردين<b class="n">${money(tot)}</b></div>${['غير مستحق', '1-30', '31-60', '61-90'].map(b => `<div class="kpi">${b}<b class="n">${money(by[b] || 0)}</b></div>`).join('')}</div>
      <div class="card">${table([{ k: 'vendor', t: 'المورد' }, { k: 'bill_no', t: 'الفاتورة' }, { k: 'supplier_ref', t: 'مرجع المورد' }, { k: 'due_date', t: 'الاستحقاق' }, num('outstanding'), { k: 'bucket', t: 'الفئة' }, { t: '', f: r => ed ? `<button class="btn teal sm noprint" data-n="${r.bill_no}" data-o="${r.outstanding}">سداد</button>` : '' }], rows)}</div>`;
    $('#pr').onclick = () => printDoc('أعمار الذمم الدائنة للموردين', table([{ k: 'vendor', t: 'المورد' }, { k: 'bill_no', t: 'الفاتورة' }, { k: 'supplier_ref', t: 'مرجع المورد' }, { k: 'due_date', t: 'الاستحقاق' }, num('outstanding', 'المستحق'), { k: 'bucket', t: 'الفئة' }], rows), { subtitle: 'جدول أعمار الذمم الدائنة' });
    m.querySelectorAll('[data-n]').forEach(b => b.onclick = guard(async () => { const a = prompt('مبلغ السداد (المتبقي ' + b.dataset.o + '):', b.dataset.o); if (!a) return; const bill = bills.find(x => x.number === b.dataset.n); await api(`/bills/${bill.id}/payments`, { method: 'POST', body: { amount: a, cash_account: '1121', method: 'bank' } }); toast('تم السداد'); VIEWS.apay(m); })); done(m);
  };
  VIEWS.purchrep = async function (m) {
    m.innerHTML = head('تقارير المشتريات', 'ملخص فواتير الموردين وتفاصيلها وضريبة المدخلات', '<button class="btn" id="pr">طباعة / PDF</button> <button class="btn ghost" id="cv-summary">CSV الملخص</button> <button class="btn ghost" id="cv-details">CSV الفواتير</button>') +
      `<div class="card noprint"><div class="row"><label>التجميع<select id="g"><option value="month">الشهر</option><option value="vendor">المورد</option><option value="branch">الفرع</option><option value="account">نوع المشتريات (الحساب)</option></select></label><label>من<input type="date" id="f" value="${today().slice(0, 4)}-01-01"></label><label>إلى<input type="date" id="t" value="${today()}"></label><button class="btn teal" id="go">عرض</button></div></div><div class="card" id="o"></div>`;
    let rows = [], detailRows = []; const go = guard(async () => { const q = `from=${$('#f').value}&to=${$('#t').value}`; [rows, detailRows] = await Promise.all([api(`/reports/purchases?group=${$('#g').value}&${q}`), api(`/reports/purchases/details?${q}`)]); const sum = (list, k) => list.reduce((s, r) => s + +r[k], 0);
      const summary = table([{ k: 'k', t: 'البند' }, { k: 'bills', t: 'عدد الفواتير' }, num('net'), num('vat'), num('total')], rows).replace('</tbody>', `<tr class="tot"><td>الإجمالي</td><td class="num">${sum(rows,'bills')}</td><td class="num">${money(sum(rows,'net'))}</td><td class="num">${money(sum(rows,'vat'))}</td><td class="num">${money(sum(rows,'total'))}</td></tr></tbody>`);
      const details = `<h3>تفاصيل فواتير الموردين</h3>` + table([{ k: 'invoice_no', t: 'رقم الفاتورة' }, { k: 'supplier_ref', t: 'مرجع المورد' }, { k: 'bill_date', t: 'التاريخ' }, { k: 'vendor', t: 'المورد' }, { k: 'branch', t: 'الفرع' }, { t: 'الحساب', f: r => esc(`${r.account_code || ''} ${r.account_name || ''}`) }, num('net'), num('vat'), num('total'), num('outstanding', 'المتبقي')], detailRows).replace('</tbody>', `<tr class="tot"><td>الإجمالي (${detailRows.length} فاتورة)</td><td colspan="5"></td><td class="num">${money(sum(detailRows,'net'))}</td><td class="num">${money(sum(detailRows,'vat'))}</td><td class="num">${money(sum(detailRows,'total'))}</td><td class="num">${money(sum(detailRows,'outstanding'))}</td></tr></tbody>`);
      $('#o').innerHTML = `<div class="printhead" style="display:block"><b>تقرير المشتريات</b> ${$('#f').value} → ${$('#t').value}</div><h3>ملخص المشتريات حسب ${$('#g').selectedOptions[0].text}</h3>${summary}${details}`; });
    $('#go').onclick = go; $('#g').onchange = go;
    $('#pr').onclick = () => printDoc('تقرير المشتريات والمدخلات', $('#o').innerHTML, { subtitle: `من ${$('#f').value} إلى ${$('#t').value}` });
    $('#cv-summary').onclick = () => rows.length && csv('purchases-summary-' + $('#g').value, rows);
    $('#cv-details').onclick = () => detailRows.length && csv('purchases-invoices', detailRows); go(); done(m);
  };


  // ================= الفروع والمناطق =================
  VIEWS.branches = async function (m) {
    const [b, s] = await Promise.all([api('/branches'), api('/stores')]); const ad = can('admin');
    m.innerHTML = head('الفروع والمناطق', 'الفرع بُعد في كل قيد ويظهر في تقارير المبيعات') + `<div class="card">${table([{ k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'الفرع' }, { k: 'name_en', t: 'English' }, { k: 'city', t: 'المدينة' }, { t: 'المتاجر', f: r => s.filter(x => x.branch_id === r.id).map(x => esc(x.name_ar)).join('، ') || '—' },
      { t: 'الحالة', f: r => r.is_active ? tag('open', 'نشط') : tag('locked', 'موقوف') }, { t: '', f: r => ad ? `<button class="btn ghost sm noprint" data-t="${r.id}" data-a="${r.is_active}">${r.is_active ? 'إيقاف' : 'تفعيل'}</button>` : '' }], b)}</div>
      ${ad ? `<div class="card noprint"><b>فرع جديد</b><div class="row"><label>الرمز<input id="bc" maxlength="8"></label><label>الاسم<input id="bn"></label><label>English<input id="be"></label><label>المدينة<input id="bt"></label><button class="btn teal" id="bs">إضافة</button></div></div>` : ''}`;
    $('#bs')?.addEventListener('click', guard(async () => { await api('/branches', { method: 'POST', body: { code: $('#bc').value.toUpperCase(), name_ar: $('#bn').value, name_en: $('#be').value, city: $('#bt').value } }); VIEWS.branches(m); }));
    m.querySelectorAll('[data-t]').forEach(x => x.onclick = guard(async () => { await api('/branches/' + x.dataset.t, { method: 'PUT', body: { is_active: x.dataset.a !== 'true' } }); VIEWS.branches(m); })); done(m);
  };

  // ================= إعدادات المتجر (مرن حسب نوع التجارة) =================
  VIEWS.stores = async function (m, sel) {
    const [stores, { types, features }, br] = await Promise.all([api('/stores'), api('/commerce-types'), api('/branches')]); const ad = can('admin');
    const s = stores.find(x => x.id === sel) || stores[0];
    if (!s) { m.innerHTML = head('إعدادات المتجر') + '<div class="card">لا توجد متاجر.</div>'; return done(m); }
    const warn = []; const safe = (p, d) => api(p).catch(e => { warn.push(e.message); return d; });
    const [w, rd] = await Promise.all([safe(`/stores/${s.id}/site`, {}), safe(`/stores/${s.id}/readiness`, { ready: false, blockers: 0, items: [], is_published: false })]); const ty = types.find(t => t.code === s.commerce_type);
    const FI = { pos: ['🧾', 'نقاط بيع سريعة وفوترة فورية'], online_shop: ['🛒', 'متجر إلكتروني عام للعملاء'], rental: ['🎪', 'تأجير الأجهزة والمعدات'], booking: ['📅', 'حجز المواعيد وطلبات الخدمة'], services: ['🛠️', 'صيانة وخدمات ما بعد البيع'], wholesale: ['📦', 'بيع بالجملة للشركات'], delivery: ['🚚', 'توصيل الطلبات للعملاء'], subscriptions: ['🔁', 'اشتراكات وفوترة دورية'], transfers: ['🏦', 'حوالات بنكية ومطابقتها'], inventory: ['🏬', 'تتبّع المخزون بالكميات'] };
    const PI = { cod: '💵', bank_transfer: '🏦', mada: '💳', card: '💳' };
    const okN = rd.items.filter(i => i.ok).length, totN = rd.items.length, pct = totN ? Math.round(okN * 100 / totN) : 0;
    if (VIEWS.stores.pane === 'new' && !ad) VIEWS.stores.pane = 'type'; VIEWS.stores.pane = VIEWS.stores.pane || 'type';
    const ico = X.ico;
    m.innerHTML = head('إعدادات المتجر والموقع', 'نوع النشاط والميزات، هوية الموقع الإلكتروني، وسائل الدفع والتوصيل، وجاهزية الإطلاق — في أقسام منفصلة.') + (warn.length ? `<div class="geo-note">⚠ تعذّر تحميل جزء من البيانات: ${esc(warn.join(' | '))}</div>` : '') +
      `<div class="tabs">${stores.map(x => `<button data-s="${x.id}" class="${x.id === s.id ? 'on' : ''}">${esc(x.name_ar)}</button>`).join('')}</div>
      <div class="card shead" style="--tc:${esc(w.theme_color || '#14B8A6')}">
        <div class="shead-main">
          <span class="shead-ic">${ico('stores', 26)}</span>
          <div><h3>${esc(s.name_ar)}</h3>
            <div class="sub"><span class="n">${esc(s.code)}</span> · ${esc(ty?.name_ar || s.commerce_type)} · ${s.features.length} ميزة مفعّلة</div></div>
          ${s.features.includes('online_shop') ? `<a class="btn ghost sm noprint" href="/shop/${esc(s.slug)}" target="_blank" rel="noopener">فتح الموقع ↗</a>` : ''}
        </div>
        <div class="shead-kpi">
          <div class="kp"><span class="sub">حالة المتجر</span>${s.is_active ? tag('open', 'نشط') : tag('locked', 'موقوف')}</div>
          <div class="kp"><span class="sub">الموقع العام</span>${rd.is_published ? tag('ok', 'منشور') : tag('locked', 'غير منشور')}</div>
          <div class="kp kp-w"><span class="sub">جاهزية التشغيل <b class="n">${okN}/${totN}</b></span><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div></div>
        </div>
      </div>
      <div class="snav noprint" role="tablist">
        <button data-pane="type" role="tab">${ico('menus', 16)} النشاط والميزات</button>
        <button data-pane="site" role="tab">${ico('orders', 16)} هوية الموقع والتواصل</button>
        <button data-pane="pay" role="tab">${ico('apay', 16)} الدفع والتوصيل والنشر</button>
        <button data-pane="ready" role="tab">${ico('doc:zatca', 16)} الجاهزية ${rd.blockers ? `<span class="bdg">${rd.blockers}</span>` : ''}</button>
        ${ad ? `<button data-pane="new" role="tab">${ico('stores', 16)} متجر جديد</button>` : ''}
      </div>

      <div class="card spane" id="sec-type" data-p="type">
        <div class="ph"><b>نوع النشاط التجاري والميزات المفعّلة</b><span class="sub">تتحكم في القوائم وشاشات المحاسبة ونقاط البيع والمتجر الإلكتروني</span></div>
        <div class="row">
          <label>نوع التجارة<select id="ct" ${ad ? '' : 'disabled'}>${types.map(t => `<option value="${t.code}" ${t.code === s.commerce_type ? 'selected' : ''}>${esc(t.name_ar)} — ${esc(t.name_en)}</option>`).join('')}</select></label>
          <label>الفرع الافتراضي<select id="cb" ${ad ? '' : 'disabled'}>${br.map(b => `<option value="${b.code}" ${b.id === s.branch_id ? 'selected' : ''}>${esc(b.name_ar)}</option>`).join('')}</select></label>
          <label>حالة المتجر<select id="ca" ${ad ? '' : 'disabled'}><option value="true" ${s.is_active ? 'selected' : ''}>نشط</option><option value="false" ${!s.is_active ? 'selected' : ''}>موقوف</option></select></label>
        </div>
        <p class="sub">${esc(ty?.description_ar || '')}</p>
        <div class="fgrid" id="ft">${features.map(f => `<label class="fcard"><input type="checkbox" value="${f.code}" ${s.features.includes(f.code) ? 'checked' : ''} ${ad ? '' : 'disabled'}><span class="fi">${(FI[f.code] || ['◻'])[0]}</span><span class="ftx"><b>${esc(f.name_ar)}</b><small>${esc((FI[f.code] || [])[1] || f.name_en || '')}</small></span><i class="sw"></i></label>`).join('')}</div>
        ${ad ? '<div class="row actions"><button class="btn ghost" id="cd">تطبيق ميزات النوع الافتراضية</button><button class="btn teal" id="cs">حفظ النوع والميزات</button></div>' : ''}
      </div>

      <div class="card spane" id="sec-site" data-p="site">
        <div class="ph"><b>هوية الموقع الإلكتروني وبيانات التواصل</b><span class="sub">ما يراه العميل في أعلى المتجر وتذييله</span></div>
        <div class="row">
          <label style="flex:2">عنوان الموقع (العربية)<input id="wt" value="${esc(w.title_ar || '')}"></label>
          <label style="flex:2">الشعار القصير (Tagline)<input id="wg" value="${esc(w.tagline_ar || '')}"></label>
          <label style="flex:0 0 120px">لون الهوية<input type="color" id="wc" value="${esc(w.theme_color || '#14B8A6')}"></label>
        </div>
        <div class="row">
          <label>رقم الجوال<input id="wp" inputmode="tel" dir="ltr" value="${esc(w.phone || '')}"></label>
          <label>رقم الواتساب<input id="ww" inputmode="tel" dir="ltr" value="${esc(w.whatsapp || '')}"></label>
          <label>البريد الإلكتروني<input id="we" type="email" dir="ltr" value="${esc(w.email || '')}"></label>
        </div>
        <div class="row">
          <label style="flex:1 1 320px">نبذة عن المتجر<textarea id="wa" rows="3">${esc(w.about_ar || '')}</textarea></label>
          <label style="flex:1 1 320px">سياسة الاستبدال والاسترجاع<textarea id="wr" rows="3">${esc(w.return_policy_ar || '')}</textarea></label>
        </div>
      </div>

      <div class="card spane" id="sec-pay" data-p="pay">
        <div class="ph"><b>وسائل الدفع والتوصيل والنشر</b><span class="sub">مدى والبطاقات تُسجَّل كطريقة دفع فقط — لا يوجد ربط ببوابة دفع</span></div>
        <p><b>وسائل الدفع المقبولة</b></p>
        <div class="fgrid fgrid-s" id="pm">${Object.entries(PAY).map(([k, l]) => `<label class="fcard"><input type="checkbox" value="${k}" ${(w.payment_methods || ['cod']).includes(k) ? 'checked' : ''}><span class="fi">${PI[k] || '💰'}</span><span class="ftx"><b>${l}</b></span><i class="sw"></i></label>`).join('')}</div>
        <p style="margin-top:14px"><b>التوصيل والحد الأدنى للطلب</b> <span class="sub">(بدون ضريبة)</span></p>
        <div class="row">
          <label>رسوم التوصيل (ريال)<input id="wd" type="number" step="0.01" min="0" value="${w.delivery_fee || 0}"></label>
          <label>توصيل مجاني للطلبات فوق (ريال)<input id="wf" type="number" step="0.01" min="0" value="${w.free_delivery_over || ''}"></label>
          <label>الحد الأدنى لقيمة الطلب (ريال)<input id="wm" type="number" step="0.01" min="0" value="${w.min_order || 0}"></label>
        </div>
        <label class="fcard pubcard"><input type="checkbox" id="wpub" ${w.is_published ? 'checked' : ''}><span class="fi">🌐</span><span class="ftx"><b>نشر المتجر والموقع الإلكتروني للعامة</b><small>تُعرض المنتجات «المنشورة» فقط، ولا يظهر الموقع إلا إذا كان المتجر نشطاً والمتجر الإلكتروني مفعّلاً</small></span><i class="sw"></i></label>
      </div>

      <div class="card spane" id="sec-ready" data-p="ready">
        <div class="ph"><b>تقرير جاهزية التشغيل والإطلاق</b>
          <span>${rd.ready ? tag('open', 'جاهز للتشغيل ✓') : tag('closed', 'ناقص ' + rd.blockers + ' بند')} ${rd.is_published ? tag('ok', 'منشور للعامة') : tag('locked', 'غير منشور')}</span></div>
        <ul class="ready rlist">${rd.items.map(i => `<li class="${i.ok ? 'ok' : 'no'}"><span class="rk">${i.ok ? '✓' : '✗'}</span><span>${esc(i.t)}${!i.ok && i.fix ? ` <span class="sub">— ${esc(i.fix)}</span>` : ''}${i.ok && i.warn ? ` <span class="sub">— تنبيه: ${esc(i.fix || 'يحتاج مراجعة')}</span>` : ''}</span></li>`).join('')}</ul>
        <p class="sub">المنتجات المنشورة: <span class="n">${rd.published_products}</span>${rd.out_of_stock_products ? ` · نافدة المخزون: <span class="n">${rd.out_of_stock_products}</span>` : ''}</p>
        ${ad ? '<div class="row noprint actions"><button class="btn teal" id="sd">ضبط الإعدادات الافتراضية (تعبئة الحقول الفارغة)</button><button class="btn ghost" id="so">استبدال الكل بالقيم الافتراضية…</button></div>' : ''}
      </div>

      ${ad ? `<div class="card noprint spane" id="sec-new" data-p="new">
        <div class="ph"><b>إضافة متجر جديد</b><span class="sub">إنشاء متجر إضافي مرتبط بفرع ونوع تجارة مخصص</span></div>
        <div class="row">
          <label>الرمز (A-Z0-9-)<input id="nc" placeholder="STORE-02" dir="ltr"></label>
          <label>الرابط slug (a-z0-9-)<input id="ns" placeholder="branch2" dir="ltr"></label>
          <label style="flex:2">الاسم بالعربية<input id="nn" placeholder="متجر فرع العليا"></label>
        </div>
        <div class="row">
          <label>النوع<select id="nt">${types.map(t => `<option value="${t.code}">${esc(t.name_ar)}</option>`).join('')}</select></label>
          <label>الفرع<select id="nb">${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label>
          <button class="btn teal" id="na">إنشاء المتجر</button>
        </div>
      </div>` : ''}
      ${ad ? '<div class="savebar noprint" id="savebar" hidden><span class="sub">تغييرات الهوية والدفع والتوصيل تُحفظ معاً</span><button class="btn teal" id="ws">حفظ إعدادات الموقع والتوصيل</button></div>' : ''}`;
    const showPane = p => { VIEWS.stores.pane = p; m.querySelectorAll('.spane').forEach(x => x.hidden = x.dataset.p !== p); m.querySelectorAll('[data-pane]').forEach(b => { const on = b.dataset.pane === p; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); const sb = m.querySelector('#savebar'); if (sb) sb.hidden = !(p === 'site' || p === 'pay'); };
    m.querySelectorAll('[data-pane]').forEach(b => b.onclick = () => showPane(b.dataset.pane)); showPane(VIEWS.stores.pane);
    m.querySelectorAll('.tabs [data-s]').forEach(b => b.onclick = () => VIEWS.stores(m, +b.dataset.s));
    const checked = sel => [...m.querySelectorAll(sel + ' input:checked')].map(i => i.value);
    $('#cd')?.addEventListener('click', () => { const t = types.find(x => x.code === $('#ct').value); m.querySelectorAll('#ft input').forEach(i => i.checked = t.default_features.includes(i.value)); });
    $('#cs')?.addEventListener('click', guard(async () => { await api('/stores/' + s.id, { method: 'PUT', body: { commerce_type: $('#ct').value, features: checked('#ft'), branch: $('#cb').value, is_active: $('#ca').value === 'true' } }); await X.reloadStores(); toast('حُفظت — القوائم تتحدّث حسب الميزات'); X.rerender(); }));
    $('#ws')?.addEventListener('click', guard(async () => { await api(`/stores/${s.id}/site`, { method: 'PUT', body: { title_ar: $('#wt').value, tagline_ar: $('#wg').value, theme_color: $('#wc').value, phone: $('#wp').value, whatsapp: $('#ww').value, email: $('#we').value, about_ar: $('#wa').value, return_policy_ar: $('#wr').value,
      payment_methods: checked('#pm'), delivery_fee: Number($('#wd').value || 0), free_delivery_over: $('#wf').value === '' ? null : Number($('#wf').value), min_order: Number($('#wm').value || 0), is_published: $('#wpub').checked } }); await X.reloadStores(); toast('حُفظت إعدادات الموقع'); VIEWS.stores(m, s.id); }));
    $('#sd')?.addEventListener('click', guard(async () => { const r = await api(`/stores/${s.id}/site/defaults`, { method: 'POST', body: { overwrite: false } }); toast(r.changed.length ? 'عُبّئت الحقول: ' + r.changed.length : 'كل الحقول معبّأة مسبقاً'); await X.reloadStores(); VIEWS.stores(m, s.id); }));
    $('#so')?.addEventListener('click', guard(async () => { if (!confirm('سيُستبدل عنوان الموقع والنبذة وسياسة الاسترجاع والدفع والتوصيل بالقيم الافتراضية لنوع النشاط. متابعة؟')) return; const r = await api(`/stores/${s.id}/site/defaults`, { method: 'POST', body: { overwrite: true } }); toast('تم الاستبدال: ' + r.changed.length + ' حقل'); await X.reloadStores(); VIEWS.stores(m, s.id); }));
    $('#na')?.addEventListener('click', guard(async () => { const r = await api('/stores', { method: 'POST', body: { code: $('#nc').value.toUpperCase(), slug: $('#ns').value, name_ar: $('#nn').value, commerce_type: $('#nt').value, branch: $('#nb').value } }); await X.reloadStores(); VIEWS.stores(m, r.id); })); done(m);
  };

  // ================= الإدارة وحسابي =================
  VIEWS.users = async function (m) {
    const ad = can('admin'); const users = ad ? await api('/users') : [];
    const [company, currencyData] = ad ? await Promise.all([api('/company'), api('/currencies')]) : [null, { currencies: [] }];
    const months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    m.innerHTML = head('الإدارة وحسابي', `المستخدم الحالي: ${esc(me().username)} (${esc(me().role)})`) +
      `<div class="card noprint"><b>تغيير كلمة مروري</b><div class="row"><label>الحالية<input type="password" id="po"></label><label>الجديدة (10+ أحرف وأرقام)<input type="password" id="pn"></label><button class="btn teal" id="pc">تغيير</button></div></div>` +
      (ad ? `<section class="card org-settings"><div class="org-head"><div><h2>بيانات المؤسسة وإعدادات الحساب</h2><p>تظهر هذه البيانات على المستندات والتقارير، وتحدد إعدادات السنة المالية والعملات.</p></div><span class="org-badge">إعدادات عامة</span></div>
        <div class="org-logo"><div class="org-logo-preview"><img id="org-logo-preview" src="${esc(company.logo_data_url||'/logo.png')}" alt="شعار المؤسسة"></div><div><b>شعار المؤسسة</b><p class="sub">PNG أو JPG أو WebP، حتى 500 كيلوبايت.</p><input type="file" id="org-logo" accept="image/png,image/jpeg,image/webp"><button class="btn ghost sm" type="button" id="org-logo-clear">إزالة الشعار المخصص</button></div></div>
        <div class="org-grid"><label>اسم المؤسسة بالعربية *<input id="org-name-ar" maxlength="200" value="${esc(company.name_ar||'')}"></label><label>اسم المؤسسة بالإنجليزية *<input id="org-name-en" maxlength="200" dir="ltr" value="${esc(company.name_en||'')}"></label>
        <label>رمز الدولة وفق ISO (حرفان)<input id="org-country" maxlength="2" pattern="[A-Za-z]{2}" placeholder="SA" value="${esc(company.country_code||'SA')}"></label><label>بداية السنة المالية<select id="org-fiscal-month">${months.map((n,i)=>`<option value="${i+1}" ${Number(company.fiscal_start_month||1)===i+1?'selected':''}>${n} — ${i+1}/01</option>`).join('')}</select></label>
        <label>العملة الأساسية<select id="org-currency">${currencyData.currencies.map(c=>`<option value="${esc(c.code.trim())}" ${c.code.trim()===(company.base_currency||'SAR').trim()?'selected':''}>${esc(c.code.trim())} — ${esc(c.name_ar)}</option>`).join('')}</select></label><label>الرقم الضريبي / رقم التسجيل<input id="org-vat" maxlength="40" inputmode="text" placeholder="رقم التسجيل الضريبي حسب الدولة" value="${esc(company.vat_number||'')}"></label>
        <label>السجل التجاري<input id="org-cr" maxlength="40" value="${esc(company.cr_number||'')}"></label><label>رقم المبنى<input id="org-building" maxlength="20" value="${esc(company.building_no||'')}"></label><label>الشارع<input id="org-street" maxlength="200" value="${esc(company.street||'')}"></label><label>الحي<input id="org-district" maxlength="120" value="${esc(company.district||'')}"></label><label>المدينة<input id="org-city" maxlength="120" value="${esc(company.city||'')}"></label><label>الرمز البريدي<input id="org-postal" maxlength="20" value="${esc(company.postal_code||'')}"></label></div>
        <div class="org-note">تغيير العملة الأساسية متاح قبل تسجيل أي قيود أو فواتير فقط. تغيير بداية السنة لا يعيد كتابة الفترات المالية السابقة.</div><div class="org-actions"><button class="btn teal" id="org-save">حفظ بيانات المؤسسة</button></div></section>` : '') +
      (ad ? `<div class="card">${table([{ k: 'username', t: 'المستخدم' }, { k: 'full_name', t: 'الاسم' }, { t: 'الدور', f: r => `<select data-r="${r.id}">${['viewer', 'cashier', 'accountant', 'admin'].map(x => `<option ${x === r.role ? 'selected' : ''}>${x}</option>`).join('')}</select>` }, { t: 'نشط', f: r => `<input type="checkbox" style="width:auto" data-u="${r.id}" ${r.is_active ? 'checked' : ''}>` }], users)}</div>
        <div class="card noprint"><b>مستخدم جديد</b><div class="row"><label>اسم المستخدم<input id="nu"></label><label>الاسم<input id="nf"></label><label>الدور<select id="nr"><option>viewer</option><option>cashier</option><option selected>accountant</option><option>admin</option></select></label><label>كلمة المرور<input type="password" id="np"></label><button class="btn teal" id="na">إضافة</button></div></div>` : '');
    $('#pc').onclick = guard(async () => { await api('/me/password', { method: 'POST', body: { old: $('#po').value, new: $('#pn').value } }); toast('تم تغيير كلمة المرور'); $('#po').value = $('#pn').value = ''; });
    if (ad) {
      let logoData=company.logo_data_url||null;
      $('#org-logo').onchange=()=>{const file=$('#org-logo').files?.[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>500*1024){toast('اختر PNG أو JPG أو WebP بحجم لا يتجاوز 500 كيلوبايت',false);$('#org-logo').value='';return;}const reader=new FileReader();reader.onload=()=>{logoData=String(reader.result);$('#org-logo-preview').src=logoData;};reader.readAsDataURL(file);};
      $('#org-logo-clear').onclick=()=>{logoData=null;$('#org-logo-preview').src='/logo.png';$('#org-logo').value='';};
      $('#org-save').onclick=guard(async()=>{const country=$('#org-country').value.trim().toUpperCase();const save=$('#org-save');save.disabled=true;try{await api('/company/settings',{method:'PUT',body:{name_ar:$('#org-name-ar').value,name_en:$('#org-name-en').value,country_code:country,base_currency:$('#org-currency').value,fiscal_start_month:Number($('#org-fiscal-month').value),vat_number:$('#org-vat').value.trim(),cr_number:$('#org-cr').value,building_no:$('#org-building').value,street:$('#org-street').value,district:$('#org-district').value,city:$('#org-city').value,postal_code:$('#org-postal').value,logo_data_url:logoData||''}});const updated=await api('/company');X.setCompany(updated);document.querySelectorAll('.brand img,.mobtop img').forEach(img=>img.src=updated.logo_data_url||'/logo.png');toast('تم حفظ بيانات المؤسسة وإعداداتها');await VIEWS.users(m);}finally{save.disabled=false;}});
      $('#na').onclick = guard(async () => { await api('/users', { method: 'POST', body: { username: $('#nu').value, full_name: $('#nf').value, role: $('#nr').value, password: $('#np').value } }); toast('تمت الإضافة'); VIEWS.users(m); });
      const upd = id => guard(async () => { const row = users.find(u => u.id === id); await api('/users/' + id, { method: 'PUT', body: { role: m.querySelector(`[data-r="${id}"]`).value, is_active: m.querySelector(`[data-u="${id}"]`).checked } }); toast('حُدّث'); VIEWS.users(m); });
      m.querySelectorAll('[data-r]').forEach(s => s.onchange = upd(+s.dataset.r)); m.querySelectorAll('[data-u]').forEach(s => s.onchange = upd(+s.dataset.u)); } done(m);
  };

  // ================= المخزون (كميات + تقييم بمتوسط التكلفة المتحرك + قيود تلقائية) =================
  VIEWS.stock = async function (m, sid) {
    const stores = (await api('/stores')).filter(x => x.is_active); const ed = can('admin', 'accountant');
    if (!stores.length) { m.innerHTML = head('أرصدة المخزون') + '<div class="card">لا يوجد متجر نشط.</div>'; return done(m); }
    sid = stores.some(x => x.id === +sid) ? +sid : stores[0].id;
    const [rows, moves, sum, partners, unvalued] = await Promise.all([api('/stock?store_id=' + sid), api('/stock/moves?store_id=' + sid), api('/stock/summary?store_id=' + sid), ed ? api('/partners') : [], ed ? api('/stock/unvalued') : []]);
    const vendors = partners.filter(p => p.kind === 'vendor');
    const KIND = { opening: 'رصيد افتتاحي', receipt: 'استلام', sale: 'بيع', sale_return: 'مرتجع', adjustment: 'تسوية جرد' };
    const gap = Number(sum.gap);
    const gapNote = Math.abs(gap) < 0.01 ? '' : gap > 0
      ? `<div class="geo-note noprint">قيمة المخزون بمتوسط التكلفة (<b class="n">${money(sum.all_stock_value)}</b>) أعلى من رصيد حساب المخزون 1140 (<b class="n">${money(sum.gl_balance)}</b>) بفرق <b class="n">${money(gap)}</b> — أرصدة سابقة بلا قيد. ${ed ? `<select id="og" style="width:auto"><option value="3100">3100 رأس المال</option><option value="3300">3300 الأرباح المبقاة</option><option value="3200">3200 الاحتياطي</option></select> <button class="btn amber sm" id="ogb">ترحيل قيد الرصيد الافتتاحي</button>` : ''}</div>`
      : `<div class="geo-note noprint">رصيد حساب المخزون 1140 (<b class="n">${money(sum.gl_balance)}</b>) أعلى من قيمة المخزون الفعلية (<b class="n">${money(sum.all_stock_value)}</b>) بفرق <b class="n">${money(-gap)}</b> — راجع فواتير موردين رُحّلت على 1140 دون تسجيل استلام.</div>`;
    m.innerHTML = head('أرصدة المخزون', 'الكميات من حركات غير قابلة للتعديل، ومُقيَّمة بمتوسط التكلفة المتحرك: الشراء يزيد المخزون 1140، والبيع يرحّل تكلفة المبيعات 5100 تلقائياً عند اعتماد الفاتورة. المتاح = الرصيد − المحجوز.', '<button class="btn" id="pr-stock">🖨️ طباعة أرصدة المخزون</button>') +
      (stores.length > 1 ? `<div class="card noprint"><label>المتجر<select id="ss">${stores.map(x => `<option value="${x.id}" ${x.id === sid ? 'selected' : ''}>${esc(x.name_ar)}</option>`).join('')}</select></label></div>` : '') +
      stockStats(sum) + gapNote +
      (ed && unvalued.length ? `<div class="card noprint"><b>استكمال تقييم المخزون غير المسعّر</b><div class="geo-note">توجد كميات موجبة بلا متوسط تكلفة؛ لن تُرحّل مبيعاتها أو تسوياتها بتكلفة صفرية. أدخل تكلفة الوحدة من فاتورة الشراء أو مستند الرصيد الافتتاحي المعتمد، مع رقم المستند. لن تُغيّر هذه العملية الحركات أو القيود السابقة.</div><label>مرجع مستند التكلفة<input id="uvref" placeholder="رقم فاتورة المورد / محضر الرصيد الافتتاحي"></label>${table([{k:'sku',t:'الرمز'},{k:'name_ar',t:'المنتج'},{t:'الكمية الحالية',f:r=>`<span class="n">${+r.on_hand}</span>`},{t:'تكلفة الوحدة الموثقة',f:r=>`<input type="number" min="0.0001" step="0.0001" data-uvcost="${r.id}" value="${Number(r.cost_price)>0?Number(r.cost_price):''}" placeholder="أدخل التكلفة" style="width:150px">`}],unvalued)}<button class="btn teal" id="uvsave">حفظ متوسطات التكلفة</button></div>` : '') +
      (ed && rows.length ? `<div class="card noprint"><b>تسجيل استلام بضاعة</b>
        <div class="row"><label style="flex:2">المنتج<select id="rp">${rows.map(r => `<option value="${r.id}">${esc(r.sku)} — ${esc(r.name_ar)}</option>`).join('')}</select></label><label>الكمية<input id="rq" type="number" min="1" step="1"></label>
          <label>تكلفة الوحدة (بدون ضريبة)<input id="rc" type="number" min="0" step="0.01"></label><label>الضريبة<select id="rv"><option value="15">15%</option><option value="0">0%</option></select></label>
          <label>تاريخ الاستلام<input id="rd" type="date" value="${today()}" max="${today()}"></label></div>
        <div class="row"><label>طريقة الشراء<select id="rm"><option value="credit">آجل (مورد)</option><option value="cash">نقداً (الصندوق)</option><option value="bank">بنك</option></select></label>
          <label id="rwl" style="flex:2">المورد<select id="rw"><option value="">— اختر —</option>${vendors.map(v => `<option value="${v.id}">${esc(v.name_ar)}</option>`).join('')}</select></label>
          <label>المرجع (فاتورة المورد)<input id="rr"></label><label>ملاحظة<input id="rn"></label><button class="btn teal" id="rs">تسجيل الاستلام</button></div>
        <div class="sub" id="rtot"></div></div>` : '') +
      `<div class="card">${rows.length ? table([{ k: 'sku', t: 'الرمز' }, { k: 'name_ar', t: 'المنتج' }, { k: 'category', t: 'التصنيف' }, { t: 'الرصيد', f: r => `<b class="n">${+r.on_hand}</b>` }, { t: 'محجوز', f: r => `<span class="n">${+r.reserved}</span>` }, { t: 'المتاح', f: r => +r.available <= 0 ? tag('locked', 'نفد') : +r.available <= 5 ? tag('closed', +r.available) : tag('open', +r.available) }, num('avg_cost', 'متوسط التكلفة'), num('stock_value', 'قيمة المخزون')], rows)
        : '<div class="geo-note">لا توجد منتجات تتبع المخزون في هذا المتجر. فعّل «تتبّع المخزون» لمنتج من المخزون ← المنتجات والأصناف، ثم سجّل الكمية الافتتاحية.</div>'}</div>
      <div class="card"><b>آخر الحركات</b>${table([{ t: 'التاريخ', f: r => `<span class="n">${esc(r.move_date)}</span>` }, { k: 'sku', t: 'الرمز' }, { k: 'product', t: 'المنتج' }, { t: 'النوع', f: r => KIND[r.kind] || r.kind }, { t: 'الكمية', f: r => `<span class="n" style="color:${+r.qty < 0 ? '#b91c1c' : '#166534'}">${+r.qty}</span>` }, { t: 'تكلفة الوحدة', f: r => r.unit_cost === null ? '' : `<span class="n">${money(r.unit_cost)}</span>` }, { t: 'القيمة', f: r => r.unit_cost === null ? '' : `<span class="n">${money(r.amount)}</span>` }, { k: 'entry_no', t: 'القيد' }, { k: 'ref', t: 'المرجع' }, { k: 'created_by', t: 'بواسطة' }], moves)}</div>
      <div class="sub">ملاحظات: الاستلام بلا «تكلفة وحدة» يُسجَّل كمية فقط بمتوسط التكلفة الحالي دون قيد. مرتجعات المبيعات (إشعار دائن) لا تعيد المخزون تلقائياً بعد.</div>`;
    $('#pr-stock').onclick = () => printDoc('تقرير أرصدة المخزون والمتاح', table([{ k: 'sku', t: 'الرمز' }, { k: 'name_ar', t: 'المنتج' }, { k: 'category', t: 'التصنيف' }, { k: 'on_hand', t: 'الرصيد الدفتري' }, { k: 'reserved', t: 'المحجوز' }, { k: 'available', t: 'المتاح' }, num('avg_cost', 'متوسط التكلفة'), num('stock_value', 'قيمة المخزون')], rows), { subtitle: `تقرير أرصدة المخزون — إجمالي الكميات ${sum.total_qty} — إجمالي القيمة ${money(sum.total_value)} ر.س` });
    $('#ss')?.addEventListener('change', e => VIEWS.stock(m, e.target.value));
    $('#uvsave')?.addEventListener('click', guard(async () => { const reference=$('#uvref').value.trim(); if(reference.length<2)return toast('أدخل رقم مستند موثوق للتكلفة',false); const items=[...m.querySelectorAll('[data-uvcost]')].filter(i=>i.value!==''&&Number(i.value)>0).map(i=>({product_id:Number(i.dataset.uvcost),unit_cost:i.value})); if(!items.length)return toast('أدخل تكلفة موثقة لصنف واحد على الأقل',false); if(!confirm(`سيُسجّل متوسط تكلفة افتتاحي للأصناف المحددة بالرجوع إلى: ${reference}. هل راجعت التكاليف مع المستندات؟`))return; const result=await api('/stock/initial-costs',{method:'POST',body:{reference,items}}); toast(`تم تقييم ${result.valued_count} صنفاً؛ أُعيد حساب القيمة وفق الكميات الحالية`); VIEWS.stock(m,sid); }));
    const recalc = () => { const q = +$('#rq')?.value || 0, c = +$('#rc')?.value || 0, v = +$('#rv')?.value || 0; if ($('#rwl')) $('#rwl').hidden = $('#rm').value !== 'credit'; if ($('#rtot')) $('#rtot').textContent = c > 0 && q > 0 ? `الصافي ${money(q * c)} + ضريبة ${money(q * c * v / 100)} = ${money(q * c * (1 + v / 100))} ر.س` : 'بلا تكلفة وحدة: يُسجَّل كمية فقط دون قيد محاسبي'; };
    ['#rq', '#rc', '#rv', '#rm'].forEach(x => $(x)?.addEventListener('input', recalc)); recalc();
    $('#ogb')?.addEventListener('click', guard(async () => { if (!confirm('سيُرحَّل قيد: مدين 1140 / دائن حساب حقوق الملكية المختار بمبلغ الفرق. متابعة؟')) return; await api('/stock/post-opening', { method: 'POST', body: { equity_account: $('#og').value } }); toast('رُحّل قيد الرصيد الافتتاحي'); VIEWS.stock(m, sid); }));
    $('#rs')?.addEventListener('click', guard(async () => { const q = $('#rq').value; if (!(Number(q) > 0)) return toast('أدخل كمية موجبة', false);
      const cost = $('#rc').value, mode = $('#rm').value; if (cost !== '' && Number(cost) > 0 && mode === 'credit' && (!$('#rw').value || !$('#rr').value.trim())) return toast('الشراء الآجل يتطلب اختيار المورد ورقم فاتورته', false);
      const r = await api('/stock/receive', { method: 'POST', body: { product_id: $('#rp').value, store_id: sid, qty: q, unit_cost: cost, vat_rate: +$('#rv').value, date: $('#rd').value || undefined, mode, vendor_id: $('#rw').value || undefined, ref: $('#rr').value, note: $('#rn').value } });
      toast(r.entry_id ? 'تم تسجيل الاستلام وترحيل القيد' : 'تم تسجيل الاستلام (كمية فقط)'); VIEWS.stock(m, sid); })); done(m);
  };
  VIEWS.count = async function (m, sid) {
    const stores = (await api('/stores')).filter(x => x.is_active); const ed = can('admin', 'accountant');
    if (!stores.length) { m.innerHTML = head('الجرد والاستلام') + '<div class="card">لا يوجد متجر نشط.</div>'; return done(m); }
    sid = stores.some(x => x.id === +sid) ? +sid : stores[0].id; const rows = await api('/stock?store_id=' + sid);
    m.innerHTML = head('الجرد والاستلام', 'أدخل الكمية المعدودة فعلياً؛ الفرق يُسجَّل كحركة «تسوية جرد» ولا يُعدَّل الرصيد مباشرة. الاستلام من «أرصدة المخزون».', '<button class="btn" id="pr-count">🖨️ طباعة مسير الجرد</button>') +
      (stores.length > 1 ? `<div class="card noprint"><label>المتجر<select id="cs0">${stores.map(x => `<option value="${x.id}" ${x.id === sid ? 'selected' : ''}>${esc(x.name_ar)}</option>`).join('')}</select></label></div>` : '') +
      `<div class="card">${rows.length ? table([{ k: 'sku', t: 'الرمز' }, { k: 'name_ar', t: 'المنتج' }, { t: 'الرصيد الدفتري', f: r => `<span class="n">${+r.on_hand}</span>` }, { t: 'المعدود فعلياً', f: r => ed ? `<input type="number" min="0" step="1" data-c="${r.id}" data-h="${+r.on_hand}" style="width:110px">` : '' }, { t: 'الفرق', f: r => `<b class="n" id="df${r.id}"></b>` }], rows) : '<div class="geo-note">لا توجد منتجات تتبع المخزون.</div>'}</div>
      ${ed && rows.length ? '<div class="card noprint"><label>ملاحظة الجرد<input id="cn" value="جرد دوري"></label><br><button class="btn amber" id="cs">اعتماد الجرد وتسوية الفروقات</button></div>' : ''}`;
    $('#pr-count').onclick = () => printDoc('مسير الجرد الفعلي للمخزون', table([{ k: 'sku', t: 'الرمز' }, { k: 'name_ar', t: 'المنتج' }, { k: 'on_hand', t: 'الرصيد الدفتري' }, { t: 'العد الفعلي', f: () => '..............' }, { t: 'فروقات الجرد', f: () => '..............' }], rows), { subtitle: 'نموذج مطابقة الجرد الدوري الفعلي للمستودع', signatures: [{ title: 'مسؤول المستودع' }, { title: 'لجنة الجرد' }, { title: 'المدير المالي' }] });
    $('#cs0')?.addEventListener('change', e => VIEWS.count(m, e.target.value));
    m.querySelectorAll('[data-c]').forEach(i => i.oninput = () => { const d = i.value === '' ? '' : Number(i.value) - Number(i.dataset.h); const el = $('#df' + i.dataset.c); el.textContent = d === '' ? '' : (d > 0 ? '+' : '') + d; el.style.color = d < 0 ? '#b91c1c' : '#166534'; });
    $('#cs')?.addEventListener('click', guard(async () => { const counts = [...m.querySelectorAll('[data-c]')].filter(i => i.value !== '').map(i => ({ product_id: +i.dataset.c, counted: i.value })); if (!counts.length) return toast('أدخل كمية واحدة على الأقل', false);
      if (!confirm('ستُسجَّل حركات تسوية للفروقات. متابعة؟')) return; const r = await api('/stock/count', { method: 'POST', body: { store_id: sid, counts, note: $('#cn').value } }); toast(`تمت التسوية: ${r.adjusted.length} صنف`); VIEWS.count(m, sid); })); done(m);
  };

  // ================= الحجوزات (تحت الفواتير والتحصيل) =================
  const BK = { new: ['closed', 'جديد'], confirmed: ['asset', 'مؤكد/مُسنَد'], in_progress: ['liability', 'قيد التنفيذ'], completed: ['open', 'مكتمل'], cancelled: ['locked', 'ملغى'] };
  let bkFilter = 'all', bkQuery = '';
  VIEWS.bookings = async function (m, tab = 'list') {
    const [list, techs, geo] = await Promise.all([api('/bookings'), api('/technicians'), api('/geo')]); const cs = can('admin', 'accountant', 'cashier'), ed = can('admin', 'accountant');
    const cnt = st => st === 'all' ? list.length : list.filter(x => x.status === st).length;
    m.innerHTML = head('الحجوزات', 'تُنشأ من المتجر الإلكتروني (منطقة ← مدينة ← حي)، ثم تُسنَد لفني وتُكتمل وتُفوتَر.', '<button class="btn" id="pr-bk-list">🖨️ طباعة قائمة الحجوزات</button>') + '<div class="tabs"></div><div id="tb"></div><div id="dt"></div>';
    $('#pr-bk-list').onclick = () => printDoc('سجل الحجوزات ومواعيد الخدمة', table([{ k: 'number', t: 'الحجز' }, { t: 'الموعد', f: r => String(r.scheduled_at).slice(0, 16).replace('T', ' ') }, { k: 'customer_name', t: 'العميل' }, { k: 'phone', t: 'الجوال' }, { t: 'الموقع', f: r => `${r.region || ''} › ${r.city || ''} › ${r.district || ''}` }, { k: 'technician', t: 'الفني' }, num('total', 'الإجمالي'), { t: 'الحالة', f: r => (BK[r.status] ? BK[r.status][1] : r.status) }, { k: 'invoice_no', t: 'الفاتورة' }], list), { subtitle: 'سجل مواعيد الزيارات والخدمات الميدانية' });
    const cityOpts = (rid, sel) => geo.cities.filter(c => !rid || c.region_id === +rid).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name_ar)}</option>`).join('');
    const regOpts = sel => geo.regions.map(r => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name_ar)}</option>`).join('');
    const techForm = t => { const city = geo.cities.find(c => c.id === t?.city_id); const rid = city?.region_id || geo.regions[0].id;
      return `<div class="card noprint"><b>${t ? 'تعديل الفني' : 'فني جديد'}</b><div class="row"><label>الاسم<input id="tn" value="${esc(t?.name_ar || '')}"></label><label>الجوال<input id="tp" value="${esc(t?.phone || '')}" inputmode="tel"></label><label>التخصص<input id="ts" value="${esc(t?.specialty || '')}"></label></div>
        <div class="row"><label>المنطقة<select id="tr">${regOpts(rid)}</select></label><label>المدينة (مكان العمل)<select id="tc"><option value="">—</option>${cityOpts(rid, t?.city_id)}</select></label><button class="btn teal" id="tg">${t ? 'حفظ' : 'إضافة'}</button>${t ? '<button class="btn ghost" id="tx">إلغاء</button>' : ''}</div></div>`; };
    const wireTechForm = t => { $('#tr')?.addEventListener('change', e => { $('#tc').innerHTML = '<option value="">—</option>' + cityOpts(e.target.value); });
      $('#tx')?.addEventListener('click', () => VIEWS.bookings(m, 'techs'));
      $('#tg')?.addEventListener('click', guard(async () => { const body = { name_ar: $('#tn').value, phone: $('#tp').value, specialty: $('#ts').value, city_id: $('#tc').value ? +$('#tc').value : null };
        if (t) await api('/technicians/' + t.id, { method: 'PUT', body }); else await api('/technicians', { method: 'POST', body }); toast('تم الحفظ'); VIEWS.bookings(m, 'techs'); })); };
    const draw = t => { tabs(m, [['list', 'قائمة الحجوزات'], ['techs', 'الفنيون']], t, draw);
      if (t === 'techs') { $('#tb').innerHTML = `<div class="card">${table([{ k: 'name_ar', t: 'الفني' }, { t: 'الجوال', f: r => `<span class="n">${esc(r.phone)}</span>` }, { t: 'المنطقة › المدينة', f: r => r.city ? esc(`${r.region} › ${r.city}`) : '—' }, { k: 'specialty', t: 'التخصص' }, { t: 'الحالة', f: r => r.is_active ? tag('open', 'نشط') : tag('locked', 'موقوف') },
          { t: '', f: r => ed ? `<span class="noprint"><button class="btn ghost sm" data-te="${r.id}">تعديل</button> <button class="btn ghost sm" data-ta="${r.id}" data-a="${r.is_active}">${r.is_active ? 'إيقاف' : 'تفعيل'}</button></span>` : '' }], techs)}</div><div id="tf">${ed ? techForm(null) : ''}</div>`;
        wireTechForm(null);
        m.querySelectorAll('[data-te]').forEach(b => b.onclick = () => { $('#tf').innerHTML = techForm(techs.find(x => x.id === +b.dataset.te)); wireTechForm(techs.find(x => x.id === +b.dataset.te)); $('#tf').scrollIntoView?.(); });
        m.querySelectorAll('[data-ta]').forEach(b => b.onclick = guard(async () => { await api('/technicians/' + b.dataset.ta, { method: 'PUT', body: { is_active: b.dataset.a !== 'true' } }); VIEWS.bookings(m, 'techs'); })); $('#dt').innerHTML = ''; return; }
      const q = bkQuery.trim(); const shown = list.filter(x => (bkFilter === 'all' || x.status === bkFilter) && (!q || [x.number, x.customer_name, x.phone, x.city, x.district, x.technician].some(v => String(v || '').includes(q))));
      $('#tb').innerHTML = `<div class="card"><div class="tabs noprint" id="bf">${[['all', 'الكل'], ...Object.entries(BK).map(([k, v]) => [k, v[1]])].map(([k, l]) => `<button data-f="${k}" class="${k === bkFilter ? 'on' : ''}">${l} (${cnt(k)})</button>`).join('')}<input id="bq" placeholder="بحث: رقم، عميل، جوال، مدينة، فني" value="${esc(bkQuery)}" style="max-width:280px"></div>
        ${table([{ k: 'number', t: 'الحجز' }, { t: 'الموعد', f: r => `<span class="n">${esc(String(r.scheduled_at).slice(0, 16))}</span>` }, { k: 'customer_name', t: 'العميل' }, { t: 'الجوال', f: r => `<span class="n">${esc(r.phone)}</span>` }, { t: 'الموقع', f: r => esc(`${r.region} › ${r.city} › ${r.district}`) }, { t: 'الفني', f: r => r.technician ? esc(r.technician) : '<span class="sub">لم يُسنَد</span>' }, num('total'), { t: 'الحالة', f: r => tag(...BK[r.status]) }, { k: 'invoice_no', t: 'الفاتورة' },
          { t: '', f: r => `<button class="btn sm noprint" data-k="${r.id}">فتح</button>` }], shown)}</div>`;
      m.querySelectorAll('#bf [data-f]').forEach(b => b.onclick = () => { bkFilter = b.dataset.f; draw('list'); });
      $('#bq').onchange = e => { bkQuery = e.target.value; draw('list'); };
      m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => open_(+b.dataset.k)); };
    const open_ = guard(async id => { const k = await api('/bookings/' + id); const reload = () => VIEWS.bookings(m, 'list');
      const locked = !!k.invoice_id ? 'disabled' : '';
      $('#dt').innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div><b>${esc(k.number)}</b> ${tag(...BK[k.status])} <span class="sub">${esc(String(k.scheduled_at).slice(0, 16))} · ${k.duration_minutes} دقيقة</span></div><button class="btn sm noprint" id="pr-bk-order">🖨️ طباعة أمر العمل / تذكرة الحجز</button></div>
        <div class="grid2"><div><p><b>العميل:</b> ${esc(k.customer_name)} <span class="n">${esc(k.phone)}</span><br><b>العنوان:</b> ${esc(k.region)} › ${esc(k.city)} › ${esc(k.district)}<br>${esc(k.street || '')} ${esc(k.building_no || '')} ${esc(k.postal_code || '')} ${esc(k.address_notes || '')}<br><b>ملاحظات:</b> ${esc(k.notes || '—')}</p>
          ${table([{ k: 'description', t: 'الخدمة' }, { k: 'qty', t: 'كمية' }, num('net'), num('vat')], k.lines)}<h4 class="n">الإجمالي: ${money(k.total)} ر.س</h4></div>
        <div class="noprint">${['new', 'confirmed'].includes(k.status) && cs ? `<b>الفني والموعد</b><div class="row"><label>التاريخ<input type="date" id="ad" value="${String(k.scheduled_at).slice(0, 10)}"></label><label>الوقت<input type="time" id="ah" step="1800" value="${String(k.scheduled_at).slice(11, 16)}"></label><label>المدة (دقيقة)<input type="number" id="am" value="${k.duration_minutes}" step="30" min="30"></label></div><div class="row"><label style="flex:3">الفني (نفس المدينة أولاً، والمشغول معطّل)<select id="at"></select></label></div><button class="btn teal sm" id="as">${k.technician_id ? 'تحديث الإسناد' : 'إسناد وتأكيد'}</button>` : k.technician ? `<b>الفني:</b> ${esc(k.technician)}` : ''}
          <p>${cs && k.status === 'confirmed' ? '<button class="btn sm" data-st="in_progress">بدء التنفيذ</button> ' : ''}${cs && ['confirmed', 'in_progress'].includes(k.status) ? '<button class="btn teal sm" data-st="completed">إكمال</button> ' : ''}${cs && ['new', 'confirmed', 'in_progress'].includes(k.status) && !k.invoice_id ? '<button class="btn coral sm" data-st="cancelled">إلغاء</button>' : ''}</p></div></div>
        ${['completed'].includes(k.status) || k.invoice_id ? `<hr><b>بيانات الفاتورة</b> <span class="sub">${k.buyer_vat ? 'فاتورة ضريبية (B2B): كل الحقول إلزامية' : 'بدون رقم ضريبي تصدر فاتورة مبسطة'}</span>
          <div class="row"><label>اسم المشتري<input id="bn" value="${esc(k.buyer_name || '')}" ${locked}></label><label>الرقم الضريبي<input id="bv" maxlength="15" value="${esc(k.buyer_vat || '')}" ${locked}></label><label>السجل التجاري<input id="bc" value="${esc(k.buyer_cr || '')}" ${locked}></label></div>
          <div class="row"><label>رقم المبنى<input id="bb" value="${esc(k.bill_building_no || '')}" ${locked}></label><label>الشارع<input id="bs" value="${esc(k.bill_street || '')}" ${locked}></label><label>الحي<input id="bd" value="${esc(k.bill_district || '')}" ${locked}></label><label>المدينة<input id="bi" value="${esc(k.bill_city || '')}" ${locked}></label><label>الرمز البريدي<input id="bp" value="${esc(k.bill_postal_code || '')}" ${locked}></label></div>
          ${k.invoice_id ? '<span class="tag t-open">تمت الفوترة</span>' : (ed ? '<button class="btn ghost sm" id="bsv">حفظ البيانات</button> <button class="btn amber" id="bin">إصدار الفاتورة</button>' : '')}` : ''}</div>`;
      $('#pr-bk-order').onclick = () => {
        const bMeta = `
          <div class="p-meta-item"><span class="p-meta-label">رقم الحجز:</span><span class="p-meta-val">${esc(k.number)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">حالة الحجز:</span><span class="p-meta-val">${esc(BK[k.status]?.[1] || k.status)}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">العميل:</span><span class="p-meta-val">${esc(k.customer_name)} (${esc(k.phone)})</span></div>
          <div class="p-meta-item"><span class="p-meta-label">الموعد المحدد:</span><span class="p-meta-val">${esc(String(k.scheduled_at).slice(0, 16).replace('T', ' '))} (${k.duration_minutes} دقيقة)</span></div>
          <div class="p-meta-item"><span class="p-meta-label">العنوان:</span><span class="p-meta-val">${esc(k.region || '')} › ${esc(k.city || '')} › ${esc(k.district || '')} ${esc(k.street || '')}</span></div>
          <div class="p-meta-item"><span class="p-meta-label">الفني المكلف:</span><span class="p-meta-val">${esc(k.technician || 'لم يُسنَد بعد')}</span></div>
          ${k.notes ? `<div class="p-meta-item"><span class="p-meta-label">ملاحظات:</span><span class="p-meta-val">${esc(k.notes)}</span></div>` : ''}
        `;
        const bTable = table([{ k: 'description', t: 'الخدمة / البند' }, { k: 'qty', t: 'الكمية' }, num('net', 'المبلغ'), num('vat', 'الضريبة')], k.lines) +
          `<div class="p-total-box"><b>الإجمالي المستحق:</b> ${money(k.total)} ر.س</div>`;
        printDoc(`أمر خدمة وزيارة ميدانية (${k.number})`, bTable, {
          ref: k.number,
          meta: bMeta,
          subtitle: 'أمر تنفيذ خدمة وزيارة فنية ميدانية',
          signatures: [
            { title: 'مسؤول الحجوزات والتنسيق' },
            { title: 'الفني المنفذ' },
            { title: 'استلام ورضا العميل' }
          ]
        });
      };
      const loadTechs = guard(async () => { const sel = $('#at'); if (!sel) return; const keep = sel.value || String(k.technician_id || '');
        const list = await api(`/bookings/${id}/technicians?date=${$('#ad').value}&time=${$('#ah').value}&duration=${$('#am').value}`);
        sel.innerHTML = list.map(t => `<option value="${t.id}" ${t.busy ? 'disabled' : ''} ${String(t.id) === keep ? 'selected' : ''}>${esc(t.name_ar)} — ${esc(t.city || 'بدون مدينة')}${t.same_city ? ' ✓ نفس مدينة الحجز' : ''}${t.busy ? ' ⚠ مشغول في هذا الموعد' : ''}</option>`).join('') || '<option value="">لا يوجد فني نشط — أضف فنياً من تبويب الفنيين</option>'; });
      ['#ad', '#ah', '#am'].forEach(x => $(x)?.addEventListener('change', loadTechs)); loadTechs();
      const billBody = () => ({ buyer_name: $('#bn').value, buyer_vat: $('#bv').value, buyer_cr: $('#bc').value, bill_building_no: $('#bb').value, bill_street: $('#bs').value, bill_district: $('#bd').value, bill_city: $('#bi').value, bill_postal_code: $('#bp').value });
      $('#as')?.addEventListener('click', guard(async () => { if (!$('#at').value) return toast('اختر فنياً', false); await api(`/bookings/${id}/assign`, { method: 'POST', body: { technician_id: $('#at').value, date: $('#ad').value, time: $('#ah').value, duration: $('#am').value } }); toast('تم الإسناد'); reload(); }));
      $('#dt').querySelectorAll('[data-st]').forEach(b => b.onclick = guard(async () => { if (b.dataset.st === 'cancelled' && !confirm('إلغاء الحجز؟')) return; await api(`/bookings/${id}/status`, { method: 'POST', body: { status: b.dataset.st } }); toast('تم'); reload(); }));
      $('#bsv')?.addEventListener('click', guard(async () => { await api(`/bookings/${id}/billing`, { method: 'PUT', body: billBody() }); toast('حُفظت بيانات الفاتورة'); }));
      $('#bin')?.addEventListener('click', guard(async () => { await api(`/bookings/${id}/billing`, { method: 'PUT', body: billBody() }); const r = await api(`/bookings/${id}/invoice`, { method: 'POST' }); toast('صدرت الفاتورة ' + r.number); printInvoice(r.id); reload(); })); $('#dt').scrollIntoView?.(); });
    draw(tab); done(m);
  };

  // ================= إدارة الأملاك: العقارات والوحدات / الملاك =================
  VIEWS.owners = async function (m) {
    const o = await api('/owners'); const ed = can('admin', 'accountant');
    m.innerHTML = head('الملاك', 'مالك فرد أو شركة، حصص الملكية للعقار لا تتجاوز 100%') + `<div class="card">${table([{ k: 'name_ar', t: 'المالك' }, { t: 'النوع', f: r => r.kind === 'company' ? 'شركة' : 'فرد' }, { t: 'الهوية / السجل', f: r => esc(r.national_id || r.cr_number || '') }, { k: 'vat_number', t: 'الرقم الضريبي' }, { k: 'phone', t: 'الجوال' }, { t: 'IBAN', f: r => `<span class="n">${esc(r.iban || '')}</span>` }, { t: 'العقارات (الحصة)', f: r => esc(r.properties || '—') },
      { t: '', f: r => ed ? `<button class="btn ghost sm noprint" data-o="${r.id}" data-a="${r.is_active}">${r.is_active ? 'إيقاف' : 'تفعيل'}</button>` : '' }], o)}</div>
      ${ed ? `<div class="card noprint"><b>مالك جديد</b><div class="row"><label>النوع<select id="ok"><option value="individual">فرد</option><option value="company">شركة</option></select></label><label style="flex:2">الاسم<input id="on"></label><label>رقم الهوية / الإقامة<input id="oi"></label><label>السجل التجاري<input id="oc"></label><label>الرقم الضريبي<input id="ov" maxlength="15"></label></div>
        <div class="row"><label>الجوال<input id="op"></label><label>البريد<input id="oe"></label><label style="flex:2">IBAN (SA + 22 رقماً)<input id="ob" maxlength="24"></label><label style="flex:2">العنوان<input id="oa"></label><button class="btn teal" id="os">إضافة</button></div></div>` : ''}`;
    $('#os')?.addEventListener('click', guard(async () => { await api('/owners', { method: 'POST', body: { kind: $('#ok').value, name_ar: $('#on').value, national_id: $('#oi').value, cr_number: $('#oc').value, vat_number: $('#ov').value, phone: $('#op').value, email: $('#oe').value, iban: $('#ob').value, address: $('#oa').value } }); VIEWS.owners(m); }));
    m.querySelectorAll('[data-o]').forEach(b => b.onclick = guard(async () => { await api('/owners/' + b.dataset.o, { method: 'PUT', body: { is_active: b.dataset.a !== 'true' } }); VIEWS.owners(m); })); done(m);
  };
  VIEWS.properties = async function (m) {
    const [p, u, br, types, owners] = await Promise.all([api('/properties'), api('/units'), api('/branches'), api('/unit-types'), api('/owners')]); const ed = can('admin', 'accountant');
    m.innerHTML = head('العقارات والوحدات', 'العقار التجاري: ضريبة 15% · السكني: معفى. «رقم الوحدة» هو رقم الوحدة الإيجارية المسجّل لدى شبكة إيجار.') +
      `<div class="card">${table([{ k: 'code', t: 'الرمز' }, { k: 'name_ar', t: 'العقار' }, { t: 'النوع', f: r => r.kind === 'commercial' ? tag('liability', 'تجاري') : tag('asset', 'سكني') }, { k: 'city', t: 'المدينة' }, { k: 'deed_no', t: 'رقم الصك' }, { k: 'units', t: 'وحدات' }, { t: '', f: r => `<button class="btn ghost sm noprint" data-ow="${r.id}">الملاك</button>` }], p)}</div><div id="ow"></div>
      <div class="card">${table([{ k: 'property', t: 'العقار' }, { t: 'رقم الوحدة (إيجار)', f: r => `<b class="n">${esc(r.unit_no)}</b>` }, { t: 'نوع الوحدة', f: r => esc(r.unit_type_name) }, { k: 'area_m2', t: 'المساحة م²' }, num('base_annual_rent'), { t: 'الحالة', f: r => r.active_lease ? tag('closed', 'مؤجرة') : tag('open', 'شاغرة') }], u)}</div>
      ${ed ? `<div class="card noprint"><b>إضافة عقار</b><div class="row"><label>الرمز<input id="pc"></label><label style="flex:2">الاسم<input id="pn"></label><label>النوع<select id="pk"><option value="commercial">تجاري</option><option value="residential">سكني</option></select></label><label>المدينة<input id="pt"></label><label>رقم الصك<input id="pd"></label><label>الفرع<select id="pb">${br.map(b => `<option value="${b.code}">${esc(b.name_ar)}</option>`).join('')}</select></label><button class="btn teal" id="pa">إضافة</button></div>
        <b>إضافة وحدة إيجارية</b><div class="row"><label>العقار<select id="up">${p.map(x => `<option value="${x.id}">${esc(x.name_ar)}</option>`).join('')}</select></label><label>رقم الوحدة (المسجّل في إيجار)<input id="un"></label><label>نوع الوحدة<select id="ut">${types.map(t => `<option value="${t.code}">${esc(t.name_ar)}</option>`).join('')}</select></label><label>المساحة م²<input id="ua" type="number" step="0.01"></label><label>الإيجار السنوي<input id="ur" type="number"></label><button class="btn teal" id="ua2">إضافة</button></div></div>` : ''}`;
    if (ed) { $('#pa').onclick = guard(async () => { await api('/properties', { method: 'POST', body: { code: $('#pc').value, name_ar: $('#pn').value, kind: $('#pk').value, city: $('#pt').value, deed_no: $('#pd').value, branch: $('#pb').value } }); VIEWS.properties(m); });
      $('#ua2').onclick = guard(async () => { await api('/units', { method: 'POST', body: { property_id: $('#up').value, unit_no: $('#un').value, unit_type: $('#ut').value, area_m2: $('#ua').value || null, base_annual_rent: $('#ur').value || null } }); VIEWS.properties(m); }); }
    m.querySelectorAll('[data-ow]').forEach(b => b.onclick = guard(async () => { const cur = await api(`/properties/${b.dataset.ow}/owners`); const rows = cur.length ? cur : [{ owner_id: '', share_pct: 100 }]; const optO = sel => `<option value="">— اختر —</option>` + owners.filter(o => o.is_active).map(o => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${esc(o.name_ar)}</option>`).join('');
      $('#ow').innerHTML = `<div class="card"><b>ملاك العقار</b><div id="orows">${rows.map(r => `<div class="row orow"><label style="flex:3">المالك<select>${optO(r.owner_id)}</select></label><label>الحصة %<input type="number" step="0.01" min="0.01" max="100" value="${r.share_pct}"></label></div>`).join('')}</div>
        ${ed ? '<button class="btn ghost sm" id="oadd">+ مالك</button> <button class="btn teal sm" id="osv">حفظ</button>' : ''}</div>`;
      $('#oadd')?.addEventListener('click', () => $('#orows').insertAdjacentHTML('beforeend', `<div class="row orow"><label style="flex:3">المالك<select>${optO('')}</select></label><label>الحصة %<input type="number" step="0.01" min="0.01" max="100" value="0"></label></div>`));
      $('#osv')?.addEventListener('click', guard(async () => { const list = [...m.querySelectorAll('.orow')].map(r => ({ owner_id: r.querySelector('select').value, share_pct: r.querySelector('input').value })).filter(r => r.owner_id); await api(`/properties/${b.dataset.ow}/owners`, { method: 'PUT', body: { owners: list } }); toast('حُفظت الملكية'); VIEWS.properties(m); })); })); done(m);
  };

  // ================= المناطق والمدن والأحياء =================
  VIEWS.geo = async function (m) {
    const g = await api('/geo'); const ad = can('admin');
    const cn = rid => g.cities.filter(c => c.region_id === rid), dn = rid => g.districts.filter(d => cn(rid).some(c => c.id === d.city_id) && !d.name_ar.startsWith('أخرى')).length;
    m.innerHTML = head('المناطق والمدن والأحياء', 'تُستخدم في حجوزات المتجر الإلكتروني: المنطقة الإدارية ← المدينة ← الحي') + `<div class="geo-note">⚠ البيانات الحالية <b>عيّنة</b>: ${g.regions.length} منطقة إدارية، ${g.cities.length} مدينة رئيسية، وأحياء المدن الكبرى فقط. لكل مدينة حي «أخرى / غير مدرج» حتى لا يتعطل الحجز. حمّل القائمة الرسمية الكاملة بالاستيراد أدناه.</div>
      <div class="card">${table([{ k: 'name_ar', t: 'المنطقة' }, { k: 'name_en', t: 'English' }, { t: 'المدن', f: r => cn(r.id).length }, { t: 'الأحياء المدرجة', f: r => dn(r.id) }], g.regions)}</div>
      ${ad ? `<div class="card noprint"><b>استيراد CSV</b> <span class="sub">كل سطر: المنطقة,المدينة,الحي (المنطقة يجب أن تطابق الأسماء أعلاه). الصفوف المكررة تُتجاهل.</span><textarea id="gi" rows="6" placeholder="الرياض,الرياض,حي جديد&#10;الشرقية,الأحساء,المبرز"></textarea><br><button class="btn teal" id="gs">استيراد</button></div>` : ''}`;
    $('#gs')?.addEventListener('click', guard(async () => { const rows = $('#gi').value.split('\n').map(l => l.split(',').map(x => x.trim())).filter(a => a.length >= 2 && a[0]).map(([region, city, district]) => ({ region, city, district })); if (!rows.length) return toast('لا توجد صفوف', false);
      const r = await api('/geo/import', { method: 'POST', body: { rows } }); toast(`أُضيف: ${r.cities} مدينة، ${r.districts} حي`); VIEWS.geo(m); })); done(m);
  };

  // ================= إعدادات القوائم: تفعيل / تعطيل إظهار القوائم =================
  VIEWS.menus = async function (m) {
    if (!can('admin')) { m.innerHTML = head('إعدادات القوائم') + '<div class="card">هذه الشاشة للمدير فقط.</div>'; return done(m); }
    const nav = X.getNav(), st = X.getMenuState(), off = new Set(st.off), COL = ['#7c3aed', '#0ea5e9', '#16a34a', '#f97316', '#db2777', '#0d9488', '#b45309'];
    let dirty = false;
    // Permission-matrix style (modern checkbox cards): a checkbox on every main menu, section and screen. Same data model as before (the `off` set).
    const ck = (id, locked) => `<label class="pk${locked ? ' lk' : ''}"><input type="checkbox" data-id="${id}" ${off.has(id) ? '' : 'checked'} ${locked ? 'disabled' : ''}><i></i></label>`;
    // Dashboard look: gradient group chips on top (same palette as the dashboard KPI tiles) and ONE masonry flow of section cards below, so no empty gaps are left.
    const GR = ['linear-gradient(135deg,#14B8A6,#0d7f74)', 'linear-gradient(135deg,#7C3AED,#5b21b6)', 'linear-gradient(135deg,#F59E0B,#c27803)', 'linear-gradient(135deg,#103555,#2a4a80)', 'linear-gradient(135deg,#0ea5e9,#0369a1)', 'linear-gradient(135deg,#16a34a,#0f7a37)', 'linear-gradient(135deg,#db2777,#9d174d)'];
    const draw = () => {
      m.innerHTML = head('إعدادات القوائم', 'فعّل أو عطّل ظهور أي قائمة رئيسية أو قسم أو شاشة. التعطيل يخفي القائمة عن جميع المستخدمين، وهو إخفاء للواجهة فقط وليس بديلاً عن الصلاحيات: كل طلب API يتحقق من الدور في الخادم، والشاشات المحمية (الإدارة وحسابي، إعدادات القوائم) لا يمكن إخفاؤها.') +
        `<div class="savebar noprint"><button class="btn" style="background:#16b364" id="sv">💾 حفظ</button><button class="btn ghost" id="rs">استعادة الافتراضي</button><span class="sub" id="dr">${dirty ? '● توجد تغييرات غير محفوظة' : ''}</span></div>` +
        `<div class="pm-chips">${nav.map((g, gi) => { const gl = st.locked.has('main:' + g.id), n = g.secs.reduce((t, sc) => t + sc.kids.length, 0), on = g.secs.reduce((t, sc) => t + sc.kids.filter(k => !off.has(k[0]) && !off.has('sec:' + sc.id)).length, 0), goff = off.has('main:' + g.id);
          return `<div class="pm-chip${goff ? ' is-off' : ''}" style="background:${GR[gi % GR.length]}">${gl ? '<span class="pk lk" title="أساسية">🔒</span>' : ck('main:' + g.id)}<span class="pm-ct">${g.ic} ${esc(g.t)}</span><b>${goff ? 0 : on}/${n}</b></div>`; }).join('')}</div>` +
        `<div class="pm-masonry">${nav.map((g, gi) => g.secs.map(sc => { const sl = st.locked.has('sec:' + sc.id), goff = off.has('main:' + g.id), dim = goff || off.has('sec:' + sc.id), act = sc.kids.filter(k => !off.has(k[0])).length;
            return `<div class="pm-card${dim ? ' is-off' : ''}"><div class="pm-chead" style="background:${GR[gi % GR.length]}">${sl ? '<span class="pk lk" title="أساسي">🔒</span>' : ck('sec:' + sc.id)}<span class="pm-t">${X.ico(sc.t ? 'sec:' + sc.id : 'main:' + g.id, 18)}<span>${esc(sc.t || g.t)}<small>${esc(g.t)}</small></span></span><b class="pm-n">${dim ? 0 : act}/${sc.kids.length}</b></div>
              <ul class="pm-list">${sc.kids.map(([id, l, f]) => { const lk = st.locked.has(id), isOff = off.has(id) || dim;
                return `<li class="${isOff ? 'off' : ''}">${lk ? '<span class="pk lk" title="لا يمكن تعطيلها">🔒</span>' : ck(id)}<span class="nm">${X.ico(id, 15)}${esc(l)}${f && !X.hasFeature(f) ? ' <small class="tag t-closed">يتطلب تفعيل ميزة في إعدادات المتجر</small>' : ''}</span></li>`; }).join('')}</ul></div>`; }).join('')).join('')}</div>`;
      // a section checkbox shows the "some screens off" (indeterminate) state when only part of its screens are hidden
      m.querySelectorAll('.pm-card').forEach(cd => { const mc = cd.querySelector('.pm-chead input'), ks = [...cd.querySelectorAll('.pm-list input')]; if (mc && mc.checked && ks.some(k => !k.checked) && ks.some(k => k.checked)) mc.indeterminate = true; });
      m.querySelectorAll('input[data-id]').forEach(i => i.onchange = () => { i.checked ? off.delete(i.dataset.id) : off.add(i.dataset.id); dirty = true; draw(); });
      $('#sv').onclick = guard(async () => { await X.applyMenu([...off]); dirty = false; toast('تم حفظ إعدادات القوائم'); X.rerender(); });
      $('#rs').onclick = () => { off.clear(); st.defaults.forEach(x => off.add(x)); dirty = true; draw(); };
      done(m); };
    draw();
  };

  // ================= المناطق والمدن والأحياء (بيانات الملف المرفق) =================
  VIEWS.geo = async function (m, flt = '') {
    const g = await api('/geo'); const ad = can('admin');
    const real = d => !d.name_ar.startsWith('أخرى'); const dn = cid => g.districts.filter(d => d.city_id === cid && real(d)).length;
    const rname = id => g.regions.find(r => r.id === id)?.name_ar || '';
    const rev = g.cities.filter(c => c.needs_review).length;
    const cities = g.cities.filter(c => !flt || c.name_ar.includes(flt) || rname(c.region_id).includes(flt));
    m.innerHTML = head('المناطق والمدن والأحياء', 'تُستخدم في حجز المتجر الإلكتروني: المنطقة الإدارية ← المدينة ← الحي') +
      `<div class="kpis"><div class="kpi">المناطق<b class="n">${g.regions.length}</b></div><div class="kpi">المدن<b class="n">${g.cities.length}</b></div><div class="kpi">الأحياء<b class="n">${g.districts.filter(real).length}</b></div><div class="kpi">مدن تحتاج مراجعة<b class="n">${rev}</b></div></div>
      <div class="geo-note">البيانات من الملف المرفق (13 منطقة، ${g.cities.length} مدينة لها أحياء، ${g.districts.filter(real).length} حياً) بإملائه كما ورد. الملف لا يحدد منطقة كل مدينة، فربطها تم بالمعرفة العامة، والمدن الموسومة <b>«تحتاج مراجعة»</b> تخمين ويجب تأكيده أو تصحيحه من هنا. لكل مدينة حي «أخرى / غير مدرج».</div>
      <div class="card"><div class="row noprint"><label>بحث (مدينة أو منطقة)<input id="gf" value="${esc(flt)}"></label></div>
      ${table([{ k: 'name_ar', t: 'المدينة' }, { t: 'المنطقة الإدارية', f: r => ad ? `<select data-c="${r.id}">${g.regions.map(x => `<option value="${x.id}" ${x.id === r.region_id ? 'selected' : ''}>${esc(x.name_ar)}</option>`).join('')}</select>` : esc(rname(r.region_id)) }, { t: 'الأحياء', f: r => dn(r.id) },
        { t: 'الحالة', f: r => r.needs_review ? tag('closed', 'تحتاج مراجعة') : tag('open', 'مؤكدة') }, { t: '', f: r => ad && r.needs_review ? `<button class="btn teal sm noprint" data-ok="${r.id}">تأكيد</button>` : '' }], cities)}</div>
      ${ad ? `<div class="card noprint"><b>استيراد CSV</b> <span class="sub">كل سطر: المنطقة,المدينة,الحي — اسم المنطقة كما في القائمة. الصفوف المكررة تُتجاهل.</span><textarea id="gi" rows="5" placeholder="منطقه الرياض,الرياض,حي جديد"></textarea><br><button class="btn teal" id="gs">استيراد</button></div>` : ''}`;
    $('#gf').onchange = e => VIEWS.geo(m, e.target.value.trim());
    m.querySelectorAll('select[data-c]').forEach(sel => sel.onchange = guard(async () => { await api('/geo/cities/' + sel.dataset.c, { method: 'PUT', body: { region_id: +sel.value, needs_review: false } }); toast('تم تحديث منطقة المدينة'); VIEWS.geo(m, flt); }));
    m.querySelectorAll('[data-ok]').forEach(b => b.onclick = guard(async () => { await api('/geo/cities/' + b.dataset.ok, { method: 'PUT', body: { needs_review: false } }); VIEWS.geo(m, flt); }));
    $('#gs')?.addEventListener('click', guard(async () => { const rows = $('#gi').value.split('\n').map(l => l.split(',').map(x => x.trim())).filter(a => a.length >= 2 && a[0]).map(([region, city, district]) => ({ region, city, district })); if (!rows.length) return toast('لا توجد صفوف', false);
      const r = await api('/geo/import', { method: 'POST', body: { rows } }); toast(`أُضيف: ${r.cities} مدينة، ${r.districts} حي`); VIEWS.geo(m, flt); })); done(m);
  };
}
