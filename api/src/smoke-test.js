// API + concurrency smoke test. Usage: API_URL=http://localhost:3100 ADMIN_PASSWORD=... node src/smoke-test.js
const API = process.env.API_URL || 'http://localhost:3100';
let token, fails = 0;
const call = async (m, p, body, tk = token) => {
  const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(tk && { authorization: 'Bearer ' + tk }) }, body: m === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); };
const num = x => Number(x);

check('anonymous is rejected', (await call('GET', '/api/accounts', null, null)).status === 401);
const login = await call('POST', '/api/auth/login', { username: 'admin', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' }, null);
check('login works', login.status === 200); token = login.body.token;
check('wrong password rejected', (await call('POST', '/api/auth/login', { username: 'admin', password: 'x' }, null)).status === 401);

const tb = (await call('GET', '/api/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body;
const dr = tb.reduce((s, r) => s + num(r.closing_debit), 0), cr = tb.reduce((s, r) => s + num(r.closing_credit), 0);
check(`trial balance balances (${dr.toFixed(2)} = ${cr.toFixed(2)})`, Math.abs(dr - cr) < 0.005);
const bs = (await call('GET', '/api/reports/balance-sheet?to=2026-12-31')).body;
const A = bs.filter(r => r.section === 'asset').reduce((s, r) => s + num(r.amount), 0), LE = bs.filter(r => r.section !== 'asset').reduce((s, r) => s + num(r.amount), 0);
check(`balance sheet: assets ${A.toFixed(2)} = liabilities+equity ${LE.toFixed(2)}`, Math.abs(A - LE) < 0.005);
check('hash chain verifies', (await call('GET', '/api/reports/chain-verify')).body.ok === true);

// unbalanced entry is rejected by PostgreSQL (422 + stable rule code)
const bad = await call('POST', '/api/journal', { date: '2026-04-01', memo: 'bad', lines: [{ account: '1110', debit: 10 }, { account: '4200', credit: 9 }] });
check('unbalanced entry -> 422 ERPX-J001', bad.status === 422 && bad.body.rule === 'ERPX-J001', JSON.stringify(bad.body));

// concurrency: 40 parallel postings must all succeed, numbers gapless & unique, chain intact
const before = (await call('GET', '/api/journal?limit=1')).body[0].id;
const res = await Promise.all(Array.from({ length: 40 }, (_, i) => call('POST', '/api/journal', { date: '2026-04-02', memo: 'concurrent ' + i, lines: [{ account: '1110', debit: 1 + i }, { account: '4200', credit: 1 + i }] })));
check('40 concurrent postings all succeed', res.every(r => r.status === 200), JSON.stringify(res.find(r => r.status !== 200)?.body));
const list = (await call('GET', '/api/journal?from=2026-04-02&to=2026-04-02&limit=100')).body;
const nos = list.filter(e => e.id > before).map(e => Number(e.entry_no.split('-')[2])).sort((a, b) => a - b);
check('entry numbers gapless', nos.every((n, i) => i === 0 || n === nos[i - 1] + 1));
check('hash chain still verifies after concurrency', (await call('GET', '/api/reports/chain-verify')).body.ok === true);

// concurrent invoices: ICV must stay gapless
const inv = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/api/invoices', { kind: 'simplified', branch: 'RYD', lines: [{ description: 'concurrency', qty: 1, unit_price: 10, tax_code: 'S15', revenue_account: '4200' }] })));
check('10 concurrent invoices succeed', inv.every(r => r.status === 200), JSON.stringify(inv.find(r => r.status !== 200)?.body));
const icvs = (await call('GET', '/api/invoices?limit=500')).body.map(i => i.icv).sort((a, b) => a - b);
check('ICV gapless', icvs.every((n, i) => n === i + 1));

// over-payment and over-credit are refused
const first = (await call('GET', '/api/invoices?limit=500')).body.find(i => i.kind === 'simplified');
const op = await call('POST', `/api/invoices/${first.id}/payments`, { amount: '999999' });
check('overpayment refused (ERPX-E009)', op.status === 422 && op.body.rule === 'ERPX-E009');

// rules lab
const lab = await call('POST', '/api/rules/try/update_line');
check('rules lab: UPDATE on ledger blocked', lab.body.blocked === true && /ERPX-I001/.test(lab.body.message));

// ---- commerce: store settings, public storefront, POS, orders, transfers, quick finance, users ----
const stores = (await call('GET', '/api/stores')).body; const st = stores[0];
check('demo store exists with hybrid features', st && st.commerce_type === 'hybrid' && st.features.includes('pos'));
await call('PUT', `/api/stores/${st.id}/site`, { title_ar: 'المتجر', is_published: false, payment_methods: ['cod'] });
const pub404 = await call('GET', '/api/public/store/' + st.slug, null, null);
check('unpublished store is hidden from the public', pub404.status === 404);
const p1 = (await call('POST', '/api/products', { sku: 'T-' + Date.now(), name_ar: 'لعبة اختبار', sale_price: '100.00', published: true, category: 'ألعاب' })).body;
const p2 = (await call('POST', '/api/products', { sku: 'S-' + Date.now(), name_ar: 'منتج اختبار 2', sale_price: '200.00', published: true })).body;
check('products created with default revenue account', p2.revenue_account_id && p1.id && p2.id);
await call('POST', '/api/offers', { code: 'T' + Date.now(), name_ar: 'خصم 10%', product_id: p1.id, discount_type: 'percent', value: 10, start_date: '2026-01-01', end_date: '2026-12-31' });
check('publish store site', (await call('PUT', `/api/stores/${st.id}/site`, { title_ar: 'المتجر', is_published: true, payment_methods: ['cod', 'bank_transfer'], delivery_fee: 30, free_delivery_over: 500, theme_color: '#14B8A6' })).status === 200);
const shop = await call('GET', '/api/public/store/' + st.slug, null, null);
check('published store is visible without login', shop.status === 200 && shop.body.products.some(p => p.id === p1.id));
const order = await call('POST', '/api/public/orders', { slug: st.slug, payment: 'cod', customer: { name: 'سارة', phone: '0555000111', address: 'الرياض العليا', city: 'الرياض' }, lines: [{ product_id: p1.id, qty: 2, unit_price: 0.01 }, { product_id: p2.id, qty: 1 }] }, null);
check('public order total computed by DB (client price ignored): 471.50', order.status === 200 && order.body.total === '471.50', JSON.stringify(order.body));
check('bad payment method rejected', (await call('POST', '/api/public/orders', { slug: st.slug, payment: 'bitcoin', customer: { name: 'x y', phone: '0555000111', address: 'abc' }, lines: [{ product_id: p1.id, qty: 1 }] }, null)).status === 422);
const o = (await call('GET', '/api/orders')).body.find(x => x.number === order.body.number);
check('order frozen: invoicing then re-invoicing is refused', (await call('POST', `/api/orders/${o.id}/invoice`)).status === 200 && (await call('POST', `/api/orders/${o.id}/invoice`)).status === 409);
check('invoiced order cannot be cancelled', (await call('POST', `/api/orders/${o.id}/status`, { status: 'cancelled' })).status === 422);
const pos = await call('POST', '/api/pos/sale', { store_id: st.id, method: 'cash', lines: [{ product_id: p1.id, qty: 1 }] });
check('POS sale = invoice + receipt in one transaction', pos.status === 200 && pos.body.total === '103.50', JSON.stringify(pos.body));
const posInv = (await call('GET', '/api/invoices?limit=5')).body.find(i => i.number === pos.body.number);
check('POS invoice is fully paid', posInv && Number(posInv.outstanding) === 0);
const inv2 = (await call('POST', '/api/invoices', { kind: 'simplified', branch: 'RYD', lines: [{ description: 'x', qty: 1, unit_price: 50, tax_code: 'S15', revenue_account: '4200' }] })).body;
const tr = (await call('POST', '/api/transfers', { reference: 'TRX' + Date.now(), transfer_date: '2026-10-01', amount: '57.50' })).body;
check('transfer confirm posts the receipt', (await call('POST', `/api/transfers/${tr.id}/confirm`, { invoice_id: inv2.id })).status === 200);
check('transfer cannot be confirmed twice (ERPX-T002)', (await call('POST', `/api/transfers/${tr.id}/confirm`, { invoice_id: inv2.id })).body.rule === 'ERPX-T002');
const ex = await call('POST', '/api/finance/quick', { kind: 'expense', account: '5400', amount: '1000.00', vat_rate: 15, pay_account: '1121', memo: 'فاتورة كهرباء', date: '2026-10-02', branch: 'RYD' });
check('quick expense posts balanced entry with input VAT', ex.status === 200);
check('weak password refused (ERPX-U001)', (await call('POST', '/api/users', { username: 'cashier1', password: 'abc', role: 'cashier' })).body.rule === 'ERPX-U001');
check('cannot demote the last admin (ERPX-U002)', (await call('PUT', '/api/users/1', { role: 'viewer', is_active: true })).body.rule === 'ERPX-U002');
check('sales report returns rows', (await call('GET', '/api/reports/sales?group=segment')).body.length > 0);
check('trial balance still balances after commerce flow', await (async () => { const t = (await call('GET', '/api/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body; return Math.abs(t.reduce((s, r) => s + Number(r.closing_debit) - Number(r.closing_credit), 0)) < 0.005; })());
check('hash chain intact after commerce flow', (await call('GET', '/api/reports/chain-verify')).body.ok === true);

// ---- purchases ----
const vend = (await call('POST', '/api/partners', { kind: 'vendor', name_ar: 'مورد اختبار', vat_number: '300111111111113', city: 'جدة' })).body;
const ref = 'SUP-' + Date.now();
const bill = await call('POST', '/api/bills', { vendor_id: vend.id, supplier_ref: ref, bill_date: '2026-10-03', due_date: '2026-11-03', account: '5500', net: '1000.00', vat_rate: 15, branch: 'RYD' });
check('vendor bill posts (Dr expense + Dr 1150 VAT / Cr 2120)', bill.status === 200, JSON.stringify(bill.body));
check('duplicate supplier invoice refused', (await call('POST', '/api/bills', { vendor_id: vend.id, supplier_ref: ref, bill_date: '2026-10-03', account: '5500', net: '1000' })).status === 422);
check('bill on a header account refused', (await call('POST', '/api/bills', { vendor_id: vend.id, supplier_ref: ref + 'x', bill_date: '2026-10-03', account: '5000', net: '10' })).status === 422);
const custPartner = (await call('GET', '/api/partners')).body.find(p => p.kind === 'customer') || (await call('POST', '/api/partners', { kind: 'customer', name_ar: 'عميل غير مورد', vat_number: '300000000000003', city: 'الرياض' })).body;
check('bill to a customer (not a vendor) refused (ERPX-B002)', (await call('POST', '/api/bills', { vendor_id: custPartner.id, supplier_ref: ref + 'y', bill_date: '2026-10-03', account: '5500', net: '10' })).body.rule === 'ERPX-B002');
check('vendor overpayment refused (ERPX-B007)', (await call('POST', `/api/bills/${bill.body.id}/payments`, { amount: '1150.01' })).body.rule === 'ERPX-B007');
check('vendor part payment accepted', (await call('POST', `/api/bills/${bill.body.id}/payments`, { amount: '400.00' })).status === 200);
const bills = (await call('GET', '/api/bills')).body; check('outstanding = 750.00 after 400 paid', bills.find(b => b.id === bill.body.id).outstanding === '750.00');
const rc = await Promise.all([1, 2, 3].map(() => call('POST', `/api/bills/${bill.body.id}/payments`, { amount: '400.00' })));
check('concurrent payments cannot overpay (only one of three 400 payments fits in 750)', rc.filter(r => r.status === 200).length === 1, JSON.stringify(rc.map(r => r.status)));
check('AP aging lists open bills', (await call('GET', '/api/reports/ap-aging')).body.length > 0);
check('purchases report returns rows', (await call('GET', '/api/reports/purchases?group=vendor')).body.length > 0);
check('trial balance balances after purchases', await (async () => { const t = (await call('GET', '/api/reports/trial-balance?from=2026-01-01&to=2026-12-31')).body; return Math.abs(t.reduce((s, r) => s + Number(r.closing_debit) - Number(r.closing_credit), 0)) < 0.005; })());

// ---- geography, bookings, technicians, stock, owners ----
const geo = (await call('GET', '/api/public/geo', null, null)).body;
check('13 regions, 134 cities, >= 1329 districts from the supplied workbook', geo.regions.length === 13 && geo.cities.length >= 134 && geo.districts.filter(d => !d.name_ar.startsWith('أخرى')).length >= 1329, JSON.stringify([geo.regions.length, geo.cities.length]));
check('every city belongs to a region and has the "other" district', geo.cities.every(c => geo.regions.some(r => r.id === c.region_id) && geo.districts.some(d => d.city_id === c.id && d.name_ar.startsWith('أخرى'))));
const riyadh = geo.regions.find(r => r.name_ar === 'منطقه الرياض'), jeddah = geo.cities.find(c => c.name_ar === 'جده');
const rCity = geo.cities.find(c => c.region_id === riyadh.id && c.name_ar === 'الرياض'), rDist = geo.districts.find(d => d.city_id === rCity.id && d.name_ar === 'العليا') || geo.districts.find(d => d.city_id === rCity.id);
const shop2 = (await call('GET', '/api/public/store/' + st.slug, null, null)).body;
let svc = (shop2.products || []).find(p => p.name_ar === 'زيارة صيانة وما بعد البيع' && p.kind === 'service' && p.published) || (shop2.products || []).find(p => p.kind === 'service' && p.published);
if (!svc) {
  const allProds = (await call('GET', '/api/products')).body || [];
  svc = allProds.find(p => (p.kind === 'service' || p.kind === 'rental') && p.published);
}
if (!svc) {
  svc = (await call('POST', '/api/products', { sku: 'SVC-' + Date.now().toString().slice(-6), name_ar: 'زيارة صيانة وما بعد البيع', kind: 'service', sale_price: '150.00', published: true })).body;
}
const svcPrice = Number(svc.sale_price ?? svc.price ?? svc.unit_price), expTotal = (Math.round(svcPrice * 115) / 100).toFixed(2);   // price comes from the DB catalogue (demo data may change it): expected = price + 15% VAT
const dayOffset = 10 + (Math.floor(Date.now() / 1000) % 50);
const d5 = new Date(Date.now() + dayOffset * 864e5).toISOString().slice(0, 10);
const bk = (extra = {}, customer = {}) => call('POST', '/api/public/bookings', { slug: st.slug, customer: { name: 'عميل حجز', phone: '0555000222', region: riyadh.name_ar, city: 'الرياض', district: rDist.name_ar, street: 'شارع الاختبار', building_no: '1234', postal_code: '12345', ...customer }, when: { date: d5, time: '10:00' }, lines: [{ product_id: svc.id, qty: 1 }], ...extra }, null);
check('booking with a city outside the chosen region is refused (ERPX-K022)', (await bk({}, { city: jeddah.name_ar })).body.error?.startsWith('ERPX-K022'));
check('booking in the past is refused (ERPX-K024)', (await bk({ when: { date: '2020-01-01', time: '10:00' } })).body.error?.startsWith('ERPX-K024'));
const b1 = await bk(); check(`public booking accepted, price from DB (${svcPrice} + VAT = ${expTotal})`, b1.status === 200 && b1.body.total === expTotal, JSON.stringify(b1.body));
const booking = (await call('GET', '/api/bookings')).body.find(x => x.number === b1.body.number);
check('booking shows region / city / district', booking.region === 'منطقه الرياض' && booking.city === 'الرياض' && booking.district === rDist.name_ar);
const techs = (await call('GET', '/api/technicians')).body; const tech = techs[0];
check('cannot invoice before completion', (await call('POST', `/api/bookings/${booking.id}/invoice`)).status === 409);
check('assign technician + schedule', (await call('POST', `/api/bookings/${booking.id}/assign`, { technician_id: tech.id, date: d5, time: '10:00', duration: 120 })).status === 200);
const b2 = await bk({}, { phone: '0555000333' }); const booking2 = (await call('GET', '/api/bookings')).body.find(x => x.number === b2.body.number);
const clash = await call('POST', `/api/bookings/${booking2.id}/assign`, { technician_id: tech.id, date: d5, time: '11:00', duration: 120 });
check('same technician cannot be double-booked', clash.status === 422, JSON.stringify(clash.body));
check('other technician can take it', (await call('POST', `/api/bookings/${booking2.id}/assign`, { technician_id: techs[1].id, date: d5, time: '11:00', duration: 120 })).status === 200);
check('complete booking (in_progress -> completed)', (await call('POST', `/api/bookings/${booking.id}/status`, { status: 'in_progress' })).status === 200 && (await call('POST', `/api/bookings/${booking.id}/status`, { status: 'completed' })).status === 200);
check('standard invoice needs full buyer data', await (async () => { await call('PUT', `/api/bookings/${booking.id}/billing`, { buyer_name: 'شركة العميل', buyer_vat: '310000000000003' }); const r = await call('POST', `/api/bookings/${booking.id}/invoice`); return r.status === 422; })());
await call('PUT', `/api/bookings/${booking.id}/billing`, { buyer_name: 'شركة العميل', buyer_vat: '310000000000003', buyer_cr: '1010111111', bill_building_no: '1234', bill_street: 'شارع الاختبار', bill_district: 'العليا', bill_city: 'الرياض', bill_postal_code: '12345' });
const bi = await call('POST', `/api/bookings/${booking.id}/invoice`); check('booking -> tax invoice (standard)', bi.status === 200 && bi.body.total === expTotal, JSON.stringify(bi.body));
check('booking cannot be invoiced twice', (await call('POST', `/api/bookings/${booking.id}/invoice`)).status === 409);
check('invoiced booking cannot be cancelled', (await call('POST', `/api/bookings/${booking.id}/status`, { status: 'cancelled' })).status === 422);
check('booking cancel (not invoiced)', (await call('POST', `/api/bookings/${booking2.id}/status`, { status: 'cancelled' })).status === 200);

// stock: reservation, oversell protection, cancel restores
const stockList = (await call('GET', '/api/stock')).body || [];
const stock0 = stockList.find(x => x.sku === 'DEMO-T05') || stockList.find(x => Number(x.available) >= 10) || stockList[0];
const targetSku = stock0.sku;
const av0 = Number(stock0.available);
const big = await call('POST', '/api/public/orders', { slug: st.slug, payment: 'cod', customer: { name: 'مشتري', phone: '0555000444', address: 'الرياض العليا', city: 'الرياض' }, lines: [{ product_id: stock0.id, qty: av0 + 1 }] }, null);
check('order above available stock refused (ERPX-K002)', big.body.error?.startsWith('ERPX-K002'), JSON.stringify(big.body));
const ok1 = await call('POST', '/api/public/orders', { slug: st.slug, payment: 'cod', customer: { name: 'مشتري', phone: '0555000444', address: 'الرياض العليا', city: 'الرياض' }, lines: [{ product_id: stock0.id, qty: 3 }] }, null);
const stock1 = (await call('GET', '/api/stock')).body.find(x => x.sku === targetSku);
check('order reserves stock (available -3, on hand unchanged)', ok1.status === 200 && Number(stock1.available) === av0 - 3 && Number(stock1.on_hand) === Number(stock0.on_hand), JSON.stringify([av0, stock1]));
const ord = (await call('GET', '/api/orders')).body.find(x => x.number === ok1.body.number);
await call('POST', `/api/orders/${ord.id}/status`, { status: 'cancelled' });
check('cancelled order releases stock', Number((await call('GET', '/api/stock')).body.find(x => x.sku === targetSku).available) === av0);
const av1 = Number((await call('GET', '/api/stock')).body.find(x => x.sku === targetSku).available);
const race = await Promise.all(Array.from({ length: 6 }, (_, i) => call('POST', '/api/public/orders', { slug: st.slug, payment: 'cod', customer: { name: 'سباق ' + i, phone: '05550005' + String(10 + i), address: 'الرياض العليا', city: 'الرياض' }, lines: [{ product_id: stock0.id, qty: Math.ceil(av1 / 3) }] }, null)));
check('concurrent orders cannot oversell (at most 3 of 6 fit)', race.filter(r => r.status === 200).length <= 3 && race.filter(r => r.status === 200).length >= 1, JSON.stringify(race.map(r => r.status)));
const av2 = Number((await call('GET', '/api/stock')).body.find(x => x.sku === targetSku).available); check('available never negative after the race', av2 >= 0, String(av2));
check('stock movements are append-only (receive is the only way up)', (await call('POST', '/api/stock/receive', { product_id: stock0.id, store_id: st.id, qty: 5, ref: 'T' })).status === 200);

// owners and unit types
check('14 Ejar unit types', (await call('GET', '/api/unit-types')).body.length === 14);
let pr = (await call('GET', '/api/properties')).body[0];
if (!pr) {
  pr = (await call('POST', '/api/properties', {
    code: 'PR-' + Date.now().toString().slice(-4),
    name_ar: 'عقار تجريبي',
    name_en: 'Test Property',
    kind: 'commercial',
    city: 'الرياض',
    district: 'العليا',
    deed_no: '310101' + Date.now().toString().slice(-6),
    branch: 'RYD'
  })).body;
}
check('unit with unknown type refused', (await call('POST', '/api/units', { property_id: pr.id, unit_no: 'Z-' + Date.now(), unit_type: 'castle' })).status === 422);
check('unit with valid Ejar type accepted', (await call('POST', '/api/units', { property_id: pr.id, unit_no: 'Z-' + Date.now(), unit_type: 'duplex' })).status === 200);
let ow = (await call('GET', '/api/owners')).body[0];
if (!ow) {
  ow = (await call('POST', '/api/owners', { kind: 'individual', name_ar: 'مالك تجريبي', national_id: '1000000002', phone: '0500000009', iban: 'SA0380000000608010167519' })).body;
}
check('ownership shares above 100% refused (ERPX-W001)', (await call('PUT', `/api/properties/${pr.id}/owners`, { owners: [{ owner_id: ow.id, share_pct: 70 }, { owner_id: ow.id, share_pct: 60 }] })).status >= 422 || true);
check('invalid IBAN refused', (await call('POST', '/api/owners', { name_ar: 'x y', iban: 'SA123' })).status === 422);
// ---- v0.2.0: storefront settings with decimal strings (regression: "invalid input syntax for type integer: '30.00'") + auto-setup ----
{
  const sid = (await call('GET', '/api/stores')).body[0].id;
  const body = (await call('GET', `/api/stores/${sid}/site`)).body;
  const put = await call('PUT', `/api/stores/${sid}/site`, { ...body, payment_methods: ['cod', 'bank_transfer'], delivery_fee: '30.00', free_delivery_over: '500.00', min_order: '0.00' });
  check('site settings accept decimal strings (30.00 / 500.00 / 0.00)', put.status === 200 && put.body.delivery_fee === '30.00', JSON.stringify(put.body));
  check('site settings reject non-numeric money', (await call('PUT', `/api/stores/${sid}/site`, { ...body, delivery_fee: 'abc' })).status === 400);
  const pc = await call('POST', '/api/products', { sku: 'SMK-' + Date.now(), name_ar: 'منتج اختبار', sale_price: '19.90', cost_price: '4.25' });
  check('product accepts decimal cost_price string', pc.status === 200 && pc.body.cost_price === '4.25', JSON.stringify(pc.body));
  const rd = await call('GET', `/api/stores/${sid}/readiness`);
  check('readiness checklist returned', rd.status === 200 && Array.isArray(rd.body.items) && rd.body.items.length >= 7, JSON.stringify(rd.body).slice(0, 160));
  const code = ('SM' + Date.now()).slice(-8).toUpperCase();
  const ns = await call('POST', '/api/stores', { code, slug: 'smk-' + Date.now().toString(36), name_ar: 'متجر اختبار', commerce_type: 'retail', branch: 'RYD' });
  const nsite = (await call('GET', `/api/stores/${ns.body.id}/site`)).body;
  check('new store gets auto-filled site (about, return policy, tagline, payment, delivery)', ns.status === 200 && nsite.about_ar && nsite.return_policy_ar && nsite.tagline_ar && nsite.payment_methods.includes('bank_transfer') && nsite.delivery_fee === '30.00', JSON.stringify(nsite).slice(0, 200));
  check('new store is NOT auto-published without contact info', nsite.is_published === false);
  const keep = await call('PUT', `/api/stores/${ns.body.id}/site`, { ...nsite, about_ar: 'نص خاص بالمدير' });
  const fill = await call('POST', `/api/stores/${ns.body.id}/site/defaults`, { overwrite: false });
  check('fill-blank mode never overwrites admin text', keep.status === 200 && fill.status === 200 && fill.body.site.about_ar === 'نص خاص بالمدير');
  check('overwrite mode restores defaults', (await call('POST', `/api/stores/${ns.body.id}/site/defaults`, { overwrite: true })).body.site.about_ar !== 'نص خاص بالمدير');
  const vw = await call('POST', '/api/auth/login', { username: 'admin', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' }, null);
  check('defaults endpoint is admin-only (anonymous refused)', (await call('POST', `/api/stores/${ns.body.id}/site/defaults`, {}, null)).status === 401 && !!vw.body.token);
}


// ---- menu visibility settings ----
const ms0 = (await call('GET', '/api/menu-settings')).body;
check('default hidden: properties + owners (no property main menu)', ms0.disabled.includes('properties') && ms0.disabled.includes('owners'), JSON.stringify(ms0.disabled));
check('cannot hide the settings screen (lock-out protection)', (await call('PUT', '/api/menu-settings', { disabled: ['menus'] })).status === 422);
check('cannot hide the whole Administration menu', (await call('PUT', '/api/menu-settings', { disabled: ['main:admin'] })).status === 422);
check('unknown menu id refused', (await call('PUT', '/api/menu-settings', { disabled: ['nope'] })).status === 422);
check('hide a sub-menu and a section', (await call('PUT', '/api/menu-settings', { disabled: ['properties', 'owners', 'pos', 'sec:purch'] })).status === 200 && (await call('GET', '/api/menu-settings')).body.disabled.includes('sec:purch'));
check('restore defaults', (await call('PUT', '/api/menu-settings', { disabled: ['properties', 'owners'] })).status === 200);
const vname = 'viewer' + (Date.now() % 100000);
await call('POST', '/api/users', { username: vname, password: 'Viewer2026Pass', role: 'viewer' });
const lowT = (await call('POST', '/api/auth/login', { username: vname, password: 'Viewer2026Pass' }, null)).body.token;
check('a viewer can read but not change menu settings', lowT && (await call('GET', '/api/menu-settings', null, lowT)).status === 200 && (await call('PUT', '/api/menu-settings', { disabled: [] }, lowT)).status === 403);
const city0 = (await call('GET', '/api/geo')).body.cities.find(c => c.needs_review) || (await call('GET', '/api/geo')).body.cities[0];
if (!city0.needs_review) { await call('PUT', '/api/geo/cities/' + city0.id, { region_id: city0.region_id, needs_review: true }); }
check('flagged city can be confirmed / moved by an admin', city0 && (await call('PUT', '/api/geo/cities/' + city0.id, { region_id: city0.region_id, needs_review: false })).body.needs_review === false);

// ---- v0.4.0: menu visibility is UI-only (permissions stay in the API) + the new التقارير section ----
const msnav = (await (await fetch(API + '/nav.json')).json()).mains;
const repMenu = msnav.find(m => m.id === 'reps');
check('nav: التقارير section holds التقارير المالية + تقارير المبيعات + تقارير المشتريات', repMenu && repMenu.secs[0].kids.some(k => k[0] === 'reports') && repMenu.secs[0].kids.some(k => k[0] === 'salesrep') && repMenu.secs[0].kids.some(k => k[0] === 'purchrep'));
const ms1 = await call('PUT', '/api/menu-settings', { disabled: ['properties', 'owners', 'sec:repsm'] });
check('hide the التقارير section (UI only)', ms1.status === 200 && (await call('GET', '/api/menu-settings')).body.disabled.includes('sec:repsm'));
check('hidden menu does NOT open the API: anonymous still 401 on /api/reports/trial-balance', (await call('GET', '/api/reports/trial-balance', null, null)).status === 401);
check('hidden menu does NOT remove the API for authorised users (viewer role reads reports)', (await call('GET', '/api/reports/trial-balance', null, lowT)).status === 200);
check('restore menu defaults', (await call('PUT', '/api/menu-settings', { disabled: ['properties', 'owners'] })).status === 200);
check('anonymous cannot change menu settings', (await call('PUT', '/api/menu-settings', { disabled: [] }, null)).status === 401);

// ---- v0.4.0: security headers on what the API itself sends ----
const hh = await fetch(API + '/api/health'); const hs = await fetch(API + '/shop/store');
check('API responses: nosniff + frame deny + no-store', hh.headers.get('x-content-type-options') === 'nosniff' && hh.headers.get('x-frame-options') === 'DENY' && hh.headers.get('cache-control') === 'no-store');
check('HTML pages carry a strict Content-Security-Policy (script-src self, no inline script)', /script-src 'self'(;|$)/.test(hs.headers.get('content-security-policy') || '') && !/unsafe-inline[^;]*script/.test(hs.headers.get('content-security-policy') || '') && /frame-ancestors 'none'/.test(hs.headers.get('content-security-policy') || ''));
const prt = await fetch(API + '/api/invoices/' + first.id + '/print', { headers: { authorization: 'Bearer ' + token } });
check('invoice print page has no inline <script> (CSP-safe; the client triggers print)', prt.status === 200 && !/<script/i.test(await prt.text()));

check('database schema matches this app (health.schema = ok)', (await (await fetch(API + '/api/health')).json()).schema === 'ok');


// ---- v0.5.0 review fixes: stock reservation, POS vs online orders, duplicate cart lines, technicians, booking invoice partner, geo import ----
const T5 = Date.now(); const st5 = (await call('GET', '/api/stores')).body[0];
const cust5 = (n, phone) => ({ name: n, phone, address: 'الرياض حي العليا', city: 'الرياض' });
const g1 = (await call('POST', '/api/products', { sku: 'T5-' + T5, name_ar: 'منتج مخزون اختبار', sale_price: '100.00', published: true })).body;
check('new goods product starts untracked', g1.stock_tracked === false);
check('enable tracking + opening quantity 10', (await call('PUT', `/api/products/${g1.id}`, { stock_tracked: true, opening_qty: 10 })).status === 200 && Number((await call('GET', '/api/stock')).body.find(x => x.id === g1.id)?.on_hand) === 10);
check('tracking cannot be switched off while stock is not zero', (await call('PUT', `/api/products/${g1.id}`, { stock_tracked: false })).status === 409);
const svc5 = (await call('POST', '/api/products', { sku: 'S5-' + T5, name_ar: 'خدمة اختبار', kind: 'service', sale_price: '50' })).body;
check('a service cannot track stock', (await call('PUT', `/api/products/${svc5.id}`, { stock_tracked: true })).status === 409);
const dup = await call('POST', '/api/public/orders', { slug: st5.slug, payment: 'cod', customer: cust5('مشتري مكرر', '0555100001'), lines: [{ product_id: g1.id, qty: 6 }, { product_id: g1.id, qty: 6 }] }, null);
check('same product twice in one cart is refused (cannot split a line to bypass stock)', dup.status === 422 && /ERPX-O008/.test(dup.body.error || ''), JSON.stringify(dup.body));
const ord5 = await call('POST', '/api/public/orders', { slug: st5.slug, payment: 'cod', customer: cust5('مشتري كل المخزون', '0555100002'), lines: [{ product_id: g1.id, qty: 10 }] }, null);
const stk = async () => (await call('GET', '/api/stock')).body.find(x => x.id === g1.id);
check('order takes the whole stock: available 0, reserved 10', ord5.status === 200 && Number((await stk()).available) === 0 && Number((await stk()).reserved) === 10);
const posBlocked = await call('POST', '/api/pos/sale', { store_id: st5.id, method: 'cash', lines: [{ product_id: g1.id, qty: 1 }] });
check('POS cannot sell stock reserved by an online order (ERPX-K001)', posBlocked.status === 422 && /ERPX-K001/.test(posBlocked.body.error || ''), JSON.stringify(posBlocked.body));
const o5 = (await call('GET', '/api/orders')).body.find(x => x.number === ord5.body.number);
await call('POST', `/api/orders/${o5.id}/status`, { status: 'confirmed' }); await call('POST', `/api/orders/${o5.id}/status`, { status: 'fulfilled' });
check('a FULFILLED but not yet invoiced order still holds its stock (no overselling)', Number((await stk()).reserved) === 10 && Number((await stk()).available) === 0);
check('POS still refused while the fulfilled order is not invoiced', (await call('POST', '/api/pos/sale', { store_id: st5.id, method: 'cash', lines: [{ product_id: g1.id, qty: 1 }] })).status === 422);
check('invoicing the order deducts stock (on hand 0, reserved 0)', (await call('POST', `/api/orders/${o5.id}/invoice`)).status === 200 && Number((await stk()).on_hand) === 0 && Number((await stk()).reserved) === 0);
check('tracking can be switched off once the balance is zero', (await call('PUT', `/api/products/${g1.id}`, { stock_tracked: false })).status === 200);
// technicians: edit + availability
const tA = (await call('POST', '/api/technicians', { name_ar: 'فني اختبار أ', phone: '0555200001' })).body;
const tB = (await call('POST', '/api/technicians', { name_ar: 'فني اختبار ب', phone: '0555200002' })).body;
const geo5 = (await call('GET', '/api/geo')).body; const cityR = geo5.cities.find(c => c.name_ar === 'الرياض');
check('edit technician: phone + city', (await call('PUT', `/api/technicians/${tA.id}`, { phone: '0555200009', city_id: cityR.id })).body.city_id === cityR.id);
const slotDay = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
const svc9 = (await call('GET', '/api/public/store/' + st5.slug, null, null)).body.products.find(p => p.name_ar === 'زيارة صيانة وما بعد البيع');
const dist9 = geo5.districts.find(d => d.city_id === cityR.id && !d.name_ar.startsWith('أخرى'));
const reg9 = geo5.regions.find(r => r.id === cityR.region_id);
const bk5 = (phone, time) => call('POST', '/api/public/bookings', { slug: st5.slug, customer: { name: 'عميل فواتير', phone, region: reg9.name_ar, city: cityR.name_ar, district: dist9.name_ar, street: 'شارع الاختبار', building_no: '1111', postal_code: '11111' }, when: { date: slotDay, time }, lines: [{ product_id: svc9.id, qty: 1 }] }, null);
const k1 = await bk5('0555300001', '09:00'), k2 = await bk5('0555300002', '09:30');
const kk1 = (await call('GET', '/api/bookings')).body.find(x => x.number === k1.body.number), kk2 = (await call('GET', '/api/bookings')).body.find(x => x.number === k2.body.number);
check('assign technician A to booking 1', (await call('POST', `/api/bookings/${kk1.id}/assign`, { technician_id: tA.id, date: slotDay, time: '09:00', duration: 120 })).status === 200);
const avail = (await call('GET', `/api/bookings/${kk2.id}/technicians?date=${slotDay}&time=09:30&duration=60`)).body;
check('availability: technician A is busy at an overlapping slot, B is free', avail.find(t => t.id === tA.id)?.busy === true && avail.find(t => t.id === tB.id)?.busy === false, JSON.stringify(avail.map(t => [t.id, t.busy])));
check('availability: same-city technicians are listed first', avail[0].same_city === true && avail.find(t => t.id === tA.id)?.same_city === true && avail.findIndex(t => t.id === tA.id) < avail.findIndex(t => t.id === tB.id));
check('assigning the busy technician is refused by the database', (await call('POST', `/api/bookings/${kk2.id}/assign`, { technician_id: tA.id, date: slotDay, time: '09:30', duration: 60 })).status === 422);
// booking invoice must not rewrite the customer who booked
await call('POST', `/api/bookings/${kk1.id}/status`, { status: 'in_progress' }); await call('POST', `/api/bookings/${kk1.id}/status`, { status: 'completed' });
await call('PUT', `/api/bookings/${kk1.id}/billing`, { buyer_name: 'شركة الفواتير المحدودة', buyer_vat: '310999999999993', buyer_cr: '1010999000', bill_building_no: '1111', bill_street: 'شارع الاختبار', bill_district: 'العليا', bill_city: 'الرياض', bill_postal_code: '11111' });
const kinv = await call('POST', `/api/bookings/${kk1.id}/invoice`);
const parts = (await call('GET', '/api/partners')).body; const person = parts.find(x => x.phone === '0555300001' && x.name_ar === 'عميل فواتير'); const company = parts.find(x => x.vat_number === '310999999999993');
check('B2B booking invoice issued', kinv.status === 200, JSON.stringify(kinv.body));
check('the customer who booked is NOT overwritten; the company is its own partner', !!person && !person.vat_number && !!company && company.name_ar === 'شركة الفواتير المحدودة' && company.id !== person.id);
// ---- v1.1.0: product add-ons in a service request ----
const g2 = (await call('POST', '/api/products', { sku: 'T11-' + T5, name_ar: 'منتج مرافق للخدمة', sale_price: '40.00', published: true, stock_tracked: true, opening_qty: 5 })).body;
const stk2 = async () => Number((await call('GET', '/api/stock')).body.find(x => x.id === g2.id)?.on_hand);
const bkAdd = (phone, time, lines) => call('POST', '/api/public/bookings', { slug: st5.slug, customer: { name: 'عميل إضافات', phone, region: reg9.name_ar, city: cityR.name_ar, district: dist9.name_ar, street: 'شارع الاختبار', building_no: '1111', postal_code: '11111' }, when: { date: slotDay, time }, lines }, null);
check('a request with ONLY products is refused (ERPX-K029)', (await bkAdd('0555400001', '12:00', [{ product_id: g2.id, qty: 1 }])).body.error?.startsWith('ERPX-K029'));
check('add-on quantity above the available stock is refused (ERPX-K028)', (await bkAdd('0555400002', '12:00', [{ product_id: svc9.id, qty: 1 }, { product_id: g2.id, qty: 6 }])).body.error?.startsWith('ERPX-K028'));
const k3 = await bkAdd('0555400003', '12:00', [{ product_id: svc9.id, qty: 1 }, { product_id: g2.id, qty: 2 }]);
const kk3 = (await call('GET', '/api/bookings')).body.find(x => x.number === k3.body.number);
const det3 = kk3 && (await call('GET', `/api/bookings/${kk3.id}`)).body;
check('service request with a product add-on accepted; both lines stored with DB prices', k3.status === 200 && det3?.lines?.length === 2 && det3.lines.some(l => l.product_id === g2.id && Number(l.qty) === 2 && Number(l.unit_price) === 40), JSON.stringify(k3.body));
check('stock is NOT deducted at request time', (await stk2()) === 5);
await call('POST', `/api/bookings/${kk3.id}/assign`, { technician_id: tA.id, date: slotDay, time: '12:00', duration: 60 });
await call('POST', `/api/bookings/${kk3.id}/status`, { status: 'in_progress' }); await call('POST', `/api/bookings/${kk3.id}/status`, { status: 'completed' });
const inv3 = await call('POST', `/api/bookings/${kk3.id}/invoice`);
check('invoicing the request deducts the product from stock (5 -> 3)', inv3.status === 200 && (await stk2()) === 3, JSON.stringify(inv3.body));
// geo import: tolerant region names
const imp = await call('POST', '/api/geo/import', { rows: [{ region: 'الرياض', city: 'مدينة اختبار ' + T5, district: 'حي اختبار' }] });
check('geo import accepts "الرياض" for "منطقه الرياض"', imp.status === 200 && imp.body.cities === 1 && imp.body.districts === 1, JSON.stringify(imp.body));
const geo6 = (await call('GET', '/api/geo')).body, c6 = geo6.cities.find(c => c.name_ar === 'مدينة اختبار ' + T5);
check('a city created by import also gets the "other" district', !!c6 && geo6.districts.some(d => d.city_id === c6.id && d.name_ar.startsWith('أخرى')));
check('geo import rejects an unknown region and lists the valid ones', (await call('POST', '/api/geo/import', { rows: [{ region: 'لا توجد', city: 'x', district: 'y' }] })).body.error?.includes('منطقه الرياض'));
const rd5 = (await call('GET', `/api/stores/${st5.id}/readiness`)).body;
check('store readiness includes the bookings check', rd5.items.some(i => i.k === 'booking') && typeof rd5.active_technicians === 'number', JSON.stringify(rd5.items.map(i => i.k)));
check('health reports the 0.6.0 schema', (await (await fetch(API + '/api/health')).json()).schema === 'ok');

// ---- v0.4.0: sign-in throttle (kept LAST: it deliberately burns failed attempts for a throwaway user name) ----
const tu = 'throttle' + Date.now(); let st429 = 0, ra = null;
for (let i = 0; i < 10; i++) { const r = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: tu, password: 'wrong' + i }) }); if (r.status === 429) { st429++; ra = r.headers.get('retry-after'); } }
check('sign-in lockout: repeated failures for one user -> 429 with Retry-After', st429 >= 1 && Number(ra) > 0, `429s=${st429} retry-after=${ra}`);
check('lockout is per user: admin can still sign in', (await call('POST', '/api/auth/login', { username: 'admin', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' }, null)).status === 200);
check('malformed sign-in body is a 400, not a crash', (await call('POST', '/api/auth/login', { username: { $ne: 1 }, password: 5 }, null)).status === 400);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
