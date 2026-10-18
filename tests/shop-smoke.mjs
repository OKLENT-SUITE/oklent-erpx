// Storefront UI checks WITHOUT a database: loads web/shop.html + shop.js in jsdom with a mocked public API.
// Run: cd api && npm i --no-save jsdom && node ../tests/shop-smoke.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { JSDOM } = createRequire(path.join(root, 'api', 'package.json'))('jsdom');
let bad = 0; const chk = (n, ok, d = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + d)); if (!ok) bad++; };
const html = fs.readFileSync(path.join(root, 'web/shop.html'), 'utf8'), js = fs.readFileSync(path.join(root, 'web/shop.js'), 'utf8');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

const prod = (id, o) => ({ id, name_ar: 'منتج ' + id, kind: 'goods', category: 'ألعاب', unit: 'قطعة', description_ar: 'وصف', image_url: null, sale_price: '100.00', unit_discount: '0.00', vat_rate: '15.00', price_incl_vat: '115.00', in_stock: true, max_qty: 99, ...o });
const PRODUCTS = [
  prod(1, { name_ar: 'سيارة ألعاب كبيرة', unit_discount: '20.00', price_incl_vat: '92.00', image_url: 'https://example.com/a.jpg' }),
  prod(2, { name_ar: 'دمية الأرنب', category: 'دمى', sale_price: '50.00', price_incl_vat: '57.50', max_qty: 3 }),
  prod(3, { name_ar: 'لعبة نافدة', in_stock: false, max_qty: 0 }),
  prod(4, { name_ar: '<img src=x onerror=alert(1)>', image_url: 'javascript:alert(1)', category: 'دمى' }),
  prod(5, { name_ar: 'صيانة منزلية', kind: 'service', category: 'خدمات', sale_price: '200.00', price_incl_vat: '230.00' }),
];
const SITE = { title_ar: 'متجر التجربة', tagline_ar: 'أفضل الألعاب', about_ar: 'نبذة', return_policy_ar: 'استرجاع خلال 7 أيام', theme_color: '#14B8A6', phone: '0500000000', whatsapp: '0500000000', email: 'a@b.sa', payment_methods: ['cod', 'mada'], delivery_fee: '20.00', free_delivery_over: '300.00', min_order: '50.00' };

async function boot({ features = ['online_shop', 'delivery'], products = PRODUCTS, site = SITE, orderStatus = 200 } = {}) {
  const posts = []; const dom = new JSDOM(html.replace(/<script src[^>]*><\/script>/, ''), { url: 'http://localhost:3100/shop/store', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
  w.Element.prototype.scrollIntoView = () => {};
  w.fetch = async (u, o) => { const url = String(u);
    if (url.startsWith('/api/public/store/')) return { ok: true, status: 200, json: async () => ({ store: { slug: 'store', name_ar: 'المتجر', commerce_type: 'retail', features }, site, products }) };
    if (url === '/api/public/geo') return { ok: true, status: 200, json: async () => ({ regions: [{ id: 1, name_ar: 'الرياض' }], cities: [{ id: 1, region_id: 1, name_ar: 'الرياض' }], districts: [{ id: 1, city_id: 1, name_ar: 'النخيل' }] }) };
    if (url === '/api/public/orders') { posts.push(JSON.parse(o.body)); return orderStatus === 200 ? { ok: true, status: 200, json: async () => ({ number: 'ORD-2026-000001', total: '345.00' }) } : { ok: false, status: orderStatus, json: async () => ({ error: 'ERPX-K002: insufficient stock for منتج 2' }) }; }
    return { ok: false, status: 404, json: async () => ({}) }; };
  w.eval(js); await tick(60); return { w, d: w.document, posts, $: s => w.document.querySelector(s), $$: s => [...w.document.querySelectorAll(s)], click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) };
}

// 1) render
{ const { d, $, $$ } = await boot();
  chk('products grid holds ONLY goods (4); the service sits in the services section', $$('#grid .pc').length === 4 && $$('#sgrid .pc').length === 1, $$('#grid .pc').length + '/' + $$('#sgrid .pc').length);
  chk('category chips cover goods only: الكل(4) + ألعاب + دمى', $$('#chips .chip').length === 3 && $('#chips .chip').textContent.includes('4'), $$('#chips .chip').map(c => c.textContent).join('|'));
  chk('offers strip shows the discounted product', $$('#offers .pc').length === 1 && /خصم 20%/.test($('#offers').textContent));
  chk('announcement bar shows free-delivery threshold', /300\.00/.test($('.ann').textContent));
  chk('discount shows old price struck', /<s class="n">115\.00<\/s>/.test($('[data-card="1"]').innerHTML));
  chk('out of stock card: disabled button + نفدت badge', $('#grid [data-card="3"] button.btn').disabled && /نفدت/.test($('#grid [data-card="3"]').textContent));
  chk('low stock badge (max 3)', /آخر 3/.test($('#grid [data-card="2"]').textContent));
  chk('store WITHOUT «booking» feature: no bookings section; service card only offers التفاصيل', $('#sec-book').hidden && /التفاصيل/.test($('#sgrid').textContent) && !$('#sgrid [data-act=add]') && !/احجز موعد فني/.test($('#sgrid').textContent));
  chk('XSS: hostile product name stays text (no injected <img>, no onerror attr anywhere)', !!$('#grid [data-card="4"]') && !$('#grid img[src="x"]') && ![...d.querySelectorAll('*')].some(e => e.hasAttribute('onerror')) && $('#grid [data-card="4"] h3').textContent === '<img src=x onerror=alert(1)>');
  chk('XSS: javascript: image url dropped (placeholder shown)', !!$('#grid [data-card="4"] .ph') && !/javascript:/.test(d.body.innerHTML));
  chk('no inline event-handler attributes on any element, no inline <script>', ![...d.querySelectorAll('*')].some(e => [...e.attributes].some(a => /^on/i.test(a.name))) && ![...d.scripts].length);
  chk('theme colour applied', d.documentElement.style.getPropertyValue('--c') === '#14B8A6' && d.title === 'متجر التجربة'); }

// 2) search / filter / sort
{ const { w, $, $$ } = await boot(); const q = $('#q');
  q.value = 'العاب'; q.dispatchEvent(new w.Event('input')); await tick(200);
  chk('search "العاب" matches «ألعاب» (hamza-insensitive): name + category -> products 1 and 3', $$('#grid .pc').length === 2, String($$('#grid .pc').length));
  q.value = 'دمية'; q.dispatchEvent(new w.Event('input')); await tick(200);
  chk('search "دمية" -> 1 result + suggestion list', $$('#grid .pc').length === 1 && !$('#sg').hidden && $$('#sg li').length === 1);
  q.value = 'zzzz'; q.dispatchEvent(new w.Event('input')); await tick(200);
  chk('no results -> empty state with reset', /لا نتائج/.test($('#grid').textContent) && !!$('[data-act=reset]'));
  $('[data-act=reset]').click(); await tick();
  chk('reset restores all', $$('#grid .pc').length === 4);
  $('#st').checked = true; $('#st').dispatchEvent(new w.Event('change')); await tick();
  chk('in-stock filter hides the sold-out product', $$('#grid .pc').length === 3 && !$('#grid [data-card="3"]'));
  $('#so').value = 'pd'; $('#so').dispatchEvent(new w.Event('change')); await tick();
  chk('sort price desc: first goods card is 115.00', /115\.00/.test($('#grid .pc').textContent), $('#grid .pc').textContent.slice(0, 80)); }

// 3) cart maths (mirrors place_online_order), delivery threshold on net excl. VAT, min order
{ const { w, $, $$, click } = await boot();
  click($('#grid [data-act=add][data-id="1"]')); await tick();
  chk('add to cart -> badge 1', $('#cc').textContent === '1' && !$('#cc').hidden);
  click($('#cb')); await tick();
  chk('drawer opens with the line', $('#dr').classList.contains('on') && $$('#drb .ci').length === 1);
  // item 1: net 80 + vat 12 = 92; delivery 20 + vat 3 = 23 -> 115
  chk('total = 92 + delivery 23 = 115.00', /115\.00 ر\.س/.test($('#drf').textContent), $('#drf').textContent.replace(/\s+/g, ' ').slice(0, 200));
  chk('free-delivery progress shown (net 80 of 300)', /220\.00/.test($('#drf .prog').textContent), $('#drf .prog')?.textContent);
  chk('min order 50 satisfied -> checkout enabled', !$('[data-act=checkout]').disabled);
  for (let i = 0; i < 3; i++) { click($('#drb [data-act=inc]')); await tick(); }
  chk('qty 4: net 320 >= 300 -> delivery FREE, total 368.00', /مجاني/.test($('#drf').textContent) && /368\.00 ر\.س/.test($('#drf').textContent), $('#drf').textContent.replace(/\s+/g, ' ').slice(0, 220));
  click($('#drb [data-act=rm]')); await tick();
  chk('remove empties cart and hides checkout', /سلتك فارغة/.test($('#drb').textContent) && !$('[data-act=checkout]'));
  click($('[data-act=close-cart]')); click($('#grid [data-act=add][data-id="2"]')); await tick(); for (let i = 0; i < 5; i++) { click($('#grid [data-card="2"] [data-act=inc]') || $('#grid [data-card="2"] [data-act=add]')); await tick(); }
  chk('stock cap: cannot exceed max_qty 3', $('#cc').textContent === '3', $('#cc').textContent);
  chk('cart persisted in localStorage', JSON.parse(w.localStorage.getItem('erpx:store:cart'))[0][1] === 3); }
{ const { $, click } = await boot({ site: { ...SITE, min_order: '500.00' } }); click($('#grid [data-act=add][data-id="1"]')); await tick(); click($('#cb')); await tick();
  chk('below min order: checkout disabled + shortfall message', $('[data-act=checkout]').disabled && /الحد الأدنى للطلب 500\.00/.test($('#drf').textContent)); }
{ const { $, click } = await boot({ features: ['online_shop'] }); click($('#grid [data-act=add][data-id="1"]')); await tick(); click($('#cb')); await tick();
  chk('store without "delivery" feature: no delivery line, total 92.00 (matches server rule)', /92\.00 ر\.س/.test($('#drf').textContent) && !/التوصيل/.test($('#drf .tot').textContent)); }

// 4) checkout: validation, normalisation, payload, success
{ const { w, $, $$, click, posts } = await boot(); click($('#grid [data-act=add][data-id="1"]')); await tick(); click($('#cb')); await tick(); click($('[data-act=checkout]')); await tick();
  chk('checkout dialog opens, drawer closes', $('#cdlg').hasAttribute('open') && !$('#dr').classList.contains('on'));
  chk('payment methods limited to the store\'s', $$('#cdlg input[name=pm]').length === 2);
  $('#cn').value = 'س'; $('#cp').value = '123'; $('#ca').value = ''; click($('#sub')); await tick();
  chk('invalid form: errors shown, nothing sent', /أدخل الاسم/.test($('#ce').textContent) && posts.length === 0 && $('#cp').getAttribute('aria-invalid') === 'true');
  $('#cn').value = 'عبدالله'; $('#cp').value = '٠٥٠ ١٢٣-٤٥٦٧'; $('#cc2').value = 'الرياض'; $('#ca').value = 'حي النخيل شارع 1'; click($('#sub')); await tick(80);
  chk('Arabic digits + separators normalised to 0501234567', posts[0]?.customer.phone === '0501234567', JSON.stringify(posts[0]?.customer));
  chk('payload: slug, payment, lines', posts[0].slug === 'store' && posts[0].payment === 'cod' && JSON.stringify(posts[0].lines) === '[{"product_id":1,"qty":1}]', JSON.stringify(posts[0]));
  chk('success screen shows the order number; cart cleared', /ORD-2026-000001/.test($('#cdlg').textContent) && $('#cc').hidden && /wa\.me\/966500000000/.test($('#cdlg').innerHTML.replace(/%[0-9A-F]{2}/g, '')));
  chk('customer details remembered locally for next time', JSON.parse(w.localStorage.getItem('erpx:store:cust')).name === 'عبدالله'); }
{ const { $, click } = await boot({ orderStatus: 422 }); click($('#grid [data-act=add][data-id="1"]')); await tick(); click($('#cb')); await tick(); click($('[data-act=checkout]')); await tick();
  $('#cn').value = 'عبدالله'; $('#cp').value = '0501234567'; $('#ca').value = 'عنوان طويل'; click($('#sub')); await tick(80);
  chk('server error shown without the ERPX code, button re-enabled, cart kept', /insufficient stock/.test($('#ce').textContent) && !/ERPX-/.test($('#ce').textContent) && !$('#sub').disabled && $('#cc').textContent === '1'); }

// 5) wishlist, product dialog, deep link
{ const { w, $, $$, click } = await boot(); click($('#grid [data-card="2"] [data-act=wish]')); await tick();
  chk('wishlist: badge 1 + heart pressed + persisted', $('#wc').textContent === '1' && $('#grid [data-card="2"] .wh').classList.contains('on') && JSON.parse(w.localStorage.getItem('erpx:store:wish')).length === 1);
  click($('#wb')); await tick(); chk('wishlist view shows only favourites', $$('#grid .pc').length === 1);
  click($('#wb')); await tick(); click($('#grid [data-card="1"] h3')); await tick();
  chk('product dialog opens with price, qty and related items', $('#pdlg').hasAttribute('open') && /92\.00/.test($('#pdlg').textContent) && !!$('#pdlg #pq') && w.location.hash === '#p1');
  $('#pq').value = '2'; click($('[data-act=add-qty]')); await tick(); chk('add from dialog respects quantity', $('#cc').textContent === '2'); }
{ const dom = await (async () => { const b = await boot(); return b; })(); chk('baseline boot ok', !!dom.$('#grid')); }
// deep link
{ const posts = []; const dom = new JSDOM(html.replace(/<script src[^>]*><\/script>/, ''), { url: 'http://localhost:3100/shop/store#p2', runScripts: 'outside-only', pretendToBeVisual: true }); const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; w.Element.prototype.scrollIntoView = () => {};
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ store: { slug: 'store', name_ar: 'المتجر', commerce_type: 'retail', features: ['online_shop'] }, site: SITE, products: PRODUCTS }) });
  w.eval(js); await tick(60); chk('deep link #p2 opens that product', w.document.querySelector('#pdlg').hasAttribute('open') && /دمية الأرنب/.test(w.document.querySelector('#pdlg').textContent)); }
// 5b) sections: المنتجات -> الخدمات -> الحجوزات, booking moved into its own section
{ const RENT = prod(6, { name_ar: 'تأجير خيمة', kind: 'rental', category: 'تأجير', sale_price: '300.00', price_incl_vat: '345.00' });
  const { w, d, $, $$, click } = await boot({ features: ['online_shop', 'booking'], products: [...PRODUCTS, RENT] });
  const order = ['sec-goods', 'sec-svc', 'sec-book'].map(id => [...d.querySelectorAll('main section')].findIndex(x => x.id === id));
  chk('page order: products, then services, then bookings', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])) && !$('#sec-svc').hidden && !$('#sec-book').hidden, order.join());
  chk('section nav lists المنتجات / الخدمات / الحجوزات in that order', $$('#sn a').map(a => a.getAttribute('href')).join() === '#list,#services,#bookings', $$('#sn a').map(a => a.getAttribute('href')).join());
  chk('«احجز موعد فني» lives in the bookings section (not on the service card)', /احجز موعد فني/.test($('#bkbox').textContent) && /اطلب الخدمة/.test($('#sgrid').textContent) && !/احجز موعد فني/.test($('#sgrid').textContent));
  chk('rentals appear under الحجوزات with their own booking button', $$('#rgrid .pc').length === 1 && /احجز التأجير/.test($('#rgrid').textContent) && !$('#grid [data-card="6"]'));
  click($('#sgrid [data-act=pick-svc]')); await tick();
  chk('«اطلب الخدمة» preselects that service in the booking box', $('#bk').value === '5' && /احجز موعد فني/.test($('#bkb').textContent));
  $('#bk').value = '6'; $('#bk').dispatchEvent(new w.Event('change')); chk('selecting a rental relabels the button', /احجز التأجير/.test($('#bkb').textContent));
  $('#bk').value = '5'; $('#bk').dispatchEvent(new w.Event('change')); click($('#bkb')); await tick(60);
  chk('booking dialog opens with the chosen service selected and the region list loaded', $('#bdlg').hasAttribute('open') && $('#bs').value === '5' && $$('#br option').length === 2); }
{ const { $ } = await boot({ features: ['online_shop', 'booking'], products: PRODUCTS.filter(p => p.kind === 'goods') }); chk('no services/rentals -> those sections stay hidden', $('#sec-svc').hidden && $('#sec-book').hidden && $('#sn').innerHTML === ''); }
{ const { $ } = await boot({ features: ['online_shop', 'booking'], products: PRODUCTS.filter(p => p.kind === 'service') }); chk('only services (no goods): products section hidden, services + bookings shown', $('#sec-goods').hidden && !$('#sec-svc').hidden && !$('#sec-book').hidden); }
// footer
{ const { $ } = await boot(); chk('footer: «© 2026 OKLENT BUSINESS. جميع الحقوق محفوظة», no oklent.net link', /© 2026 OKLENT BUSINESS\.\s*جميع الحقوق محفوظة/.test($('footer.ft').textContent) && !/oklent\.net/i.test($('footer.ft').innerHTML));
  chk('link back to the system (/) in the header and the footer', $('#sys').getAttribute('href') === '/' && $('#sysf').getAttribute('href') === '/');
  const c1 = $('[data-card="1"]'), im = c1.querySelector('.im img'); im.dispatchEvent(new (im.ownerDocument.defaultView.Event)('error')); chk('broken product image -> placeholder, no broken-image icon', !c1.querySelector('.im img') && !!c1.querySelector('.im .ph')); }
// 6) failure states
{ const dom = new JSDOM(html.replace(/<script src[^>]*><\/script>/, ''), { url: 'http://localhost:3100/shop/store', runScripts: 'outside-only' }); dom.window.fetch = async () => { throw new Error('net'); }; dom.window.eval(js); await tick(40);
  chk('API unreachable -> message + retry (no endless spinner)', /تعذّر الاتصال/.test(dom.window.document.body.textContent) && !!dom.window.document.getElementById('rt')); }
{ const dom = new JSDOM(html.replace(/<script src[^>]*><\/script>/, ''), { url: 'http://localhost:3100/shop/none', runScripts: 'outside-only' }); dom.window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) }); dom.window.eval(js); await tick(40);
  chk('404 -> «المتجر غير متاح»', /المتجر غير متاح/.test(dom.window.document.body.textContent)); }
{ const { $ } = await boot({ products: [] }); chk('empty catalogue -> friendly empty state', /لا توجد منتجات منشورة/.test($('#grid').textContent)); }
console.log(bad ? `\n${bad} FAILED` : '\nALL STOREFRONT CHECKS PASSED'); process.exit(bad ? 1 : 0);
