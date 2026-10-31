// ACC-02 / DATA-01 / T-06 / T-07: concurrency + idempotency against a RUNNING API.   node tests/concurrency.mjs
// Env: API_URL, ADMIN_PASSWORD, CONC (parallel requests, default 100).
const API = process.env.API_URL || 'http://localhost:3100', N = Number(process.env.CONC || 100);
let tk, failed = 0;
const call = async (m, p, b, extra = {}, anon = false) => { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(tk && !anon && { authorization: 'Bearer ' + tk }), ...extra }, body: m === 'GET' ? undefined : JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const ck = (n, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  → ' + x}`); };
const par = (n, f) => Promise.all(Array.from({ length: n }, (_, i) => f(i)));
tk = (await call('POST', '/api/auth/login', { username: 'admin', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' })).body.token;
const T = Date.now(), st = (await call('GET', '/api/stores')).body[0];
const svcLine = { description: 'concurrency', qty: 1, unit_price: 10, tax_code: 'S15', revenue_account: '4200' };

// C1 — N parallel invoices: unique numbers, gapless ICV, intact chain, balanced books
const before = (await call('GET', '/api/invoices?limit=1')).body[0]?.number;
const r1 = await par(N, () => call('POST', '/api/invoices', { kind: 'simplified', branch: 'RYD', lines: [svcLine] }));
const okc = r1.filter(r => r.status === 200), codes = [...new Set(r1.map(r => r.status))];
ck(`C1 ${N} parallel invoices: all succeed (statuses ${codes})`, okc.length === N, JSON.stringify(r1.find(r => r.status !== 200)?.body));
ck('C1 invoice numbers unique', new Set(okc.map(r => r.body.number)).size === okc.length);
const icvs = okc.map(r => Number(r.body.icv)).sort((a, b) => a - b);
ck('C1 ICV values unique and consecutive (gapless)', new Set(icvs).size === icvs.length && icvs.every((v, i) => i === 0 || v === icvs[i - 1] + 1), icvs.slice(0, 5).join());
ck('C1 hash chain verifies', (await call('GET', '/api/reports/chain-verify')).body.ok === true);
const tb = (await call('GET', '/api/reports/trial-balance?from=2000-01-01&to=2099-12-31')).body;
ck('C1 trial balance still balances', Math.abs(tb.reduce((s, r) => s + Number(r.closing_debit) - Number(r.closing_credit), 0)) < 0.005);

// C2 — limited stock: 5 in stock, N parallel sales of 1 -> exactly 5 succeed, never negative
const g = (await call('POST', '/api/products', { sku: 'CC-' + T, name_ar: 'صنف تزامن', sale_price: '10', published: true, stock_tracked: true, opening_qty: 0 })).body;
await call('POST', '/api/stock/receive', { product_id: g.id, store_id: st.id, qty: 5, unit_cost: '4', mode: 'cash' });
const r2 = await par(N, () => call('POST', '/api/invoices', { kind: 'simplified', branch: 'RYD', store_id: st.id, lines: [{ product_id: g.id, qty: 1 }] }));
const won = r2.filter(r => r.status === 200).length, refused = r2.filter(r => r.status === 422).length;
ck(`C2 stock 5, ${N} parallel sales -> exactly 5 succeed (got ${won}, refused ${refused}, other ${N - won - refused})`, won === 5 && refused === N - 5, JSON.stringify(r2.find(r => ![200, 422].includes(r.status))?.body));
const onhand = (await call('GET', '/api/stock')).body.find(x => x.id === g.id || x.product_id === g.id);
ck('C2 on-hand is exactly 0 (never negative)', onhand && Number(onhand.on_hand ?? onhand.qty ?? onhand.quantity) === 0, JSON.stringify(onhand));

// C3 — the same booking invoiced N times in parallel -> exactly one invoice
const geo = (await call('GET', '/api/public/geo', null)).body, reg = geo.regions.find(r => r.name_ar === 'منطقه الرياض'), city = geo.cities.find(c => c.region_id === reg.id && c.name_ar === 'الرياض'), dist = geo.districts.find(d => d.city_id === city.id);
const shop = (await call('GET', '/api/public/store/' + st.slug)).body, svc = (shop.products || []).find(p => p.kind === 'service' && p.published) || (await call('GET', '/api/products')).body.find(p => (p.kind === 'service' || p.kind === 'rental') && p.published);
const bk = (idem) => call('POST', '/api/public/bookings', { slug: st.slug, customer: { name: 'تزامن', phone: '05' + String(T).slice(-8), region: reg.name_ar, city: city.name_ar, district: dist.name_ar, street: 'شارع الاختبار', building_no: '1234', postal_code: '12345' }, when: { date: new Date(Date.now() + (20 + T % 30) * 864e5).toISOString().slice(0, 10), time: '10:00' }, lines: [{ product_id: svc.id, qty: 1 }] }, idem ? { 'idempotency-key': idem } : {}, true);
const b = await bk(); const bn = (await call('GET', '/api/bookings')).body.find(x => x.number === b.body.number);
if (!bn) ck('C3 booking fixture created', false, JSON.stringify(b.body)); else {
  const tech = (await call('GET', '/api/technicians')).body[0];
  await call('POST', `/api/bookings/${bn.id}/assign`, { technician_id: tech.id, date: new Date(Date.now() + (20 + T % 30) * 864e5).toISOString().slice(0, 10), time: '10:00', duration: 60 });
  await call('POST', `/api/bookings/${bn.id}/status`, { status: 'in_progress' }); await call('POST', `/api/bookings/${bn.id}/status`, { status: 'completed' });
  const r3 = await par(10, () => call('POST', `/api/bookings/${bn.id}/invoice`));
  const w3 = r3.filter(r => r.status === 200), losers = r3.filter(r => r.status !== 200), linked = (await call('GET', `/api/bookings/${bn.id}`)).body.invoice_id;
  ck(`C3 10 parallel "invoice this booking" -> exactly ONE invoice, the rest refused cleanly (200s=${w3.length}, others ${[...new Set(losers.map(r => r.status))]})`,
    w3.length === 1 && losers.every(r => [409, 422].includes(r.status)) && linked && String(linked) === String(w3[0].body.id), JSON.stringify(r3.filter(r => r.status >= 500).map(r => r.body)));
}

// C4 — N employees created in parallel without an explicit number (DATA-01)
const r4 = await par(N, i => call('POST', '/api/employees', { name_ar: 'موظف تزامن ' + T + '-' + i }));
const e4 = r4.filter(r => r.status === 200);
ck(`C4 ${N} parallel employees: all created, no 5xx (statuses ${[...new Set(r4.map(r => r.status))]})`, e4.length === N, JSON.stringify(r4.find(r => r.status !== 200)?.body));
ck('C4 employee numbers unique', new Set(e4.map(r => r.body.employee_no)).size === e4.length);
ck('C4 caller-supplied duplicate number -> clean 409/422 (not 500)', await (async () => { const n = e4[0]?.body.employee_no; const r = await call('POST', '/api/employees', { name_ar: 'مكرر', employee_no: n }); return [409, 422].includes(r.status); })());
for (const e of e4) await call('DELETE', '/api/employees/' + e.body.id);

// T-07 — idempotency: the same request retried with the same Idempotency-Key creates ONE financial document
const key = 'idem-' + T, a = await call('POST', '/api/invoices', { kind: 'simplified', branch: 'RYD', lines: [svcLine] }, { 'idempotency-key': key });
const a2 = await call('POST', '/api/invoices', { kind: 'simplified', branch: 'RYD', lines: [svcLine] }, { 'idempotency-key': key });
ck('T-07 invoice retry with the same key returns the SAME invoice', a.status === 200 && a2.status === 200 && a.body.id === a2.body.id && a.body.number === a2.body.number, JSON.stringify([a.body.number, a2.body.number, a2.status]));
const pr = await par(8, () => call('POST', '/api/invoices', { kind: 'simplified', branch: 'RYD', lines: [svcLine] }, { 'idempotency-key': key + '-par' }));
ck('T-07 8 PARALLEL retries with one key -> one invoice', new Set(pr.filter(r => r.status === 200).map(r => r.body.id)).size === 1 && pr.every(r => [200, 409].includes(r.status)), JSON.stringify(pr.map(r => r.status)));
ck('T-07 same key + different payload -> 422', (await call('POST', '/api/invoices', { kind: 'simplified', branch: 'RYD', lines: [{ ...svcLine, unit_price: 99 }] }, { 'idempotency-key': key })).status === 422);
const bi1 = await bk('bk-' + T), bi2 = await bk('bk-' + T);
ck('T-07 public booking retry with the same key returns the same booking number', bi1.status === 200 && bi2.status === 200 && bi1.body.number === bi2.body.number, JSON.stringify([bi1.body, bi2.body]));
console.log(failed ? `\n${failed} FAILED` : '\nALL CONCURRENCY / IDEMPOTENCY CHECKS PASSED'); process.exit(failed ? 1 : 0);
