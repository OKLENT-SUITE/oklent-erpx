import { riyadhToday } from './dates.js';
// Demo data: partners, property portfolio, leases, invoices, payments, expenses. Everything goes through the real engine.
// Usage: API_URL=http://localhost:3100 ADMIN_PASSWORD=... node src/seed-demo.js
const API = process.env.API_URL || 'http://localhost:3100';
let token;
const call = async (m, p, body) => {
  const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: m === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${j.error}`); return j;
};
token = (await call('POST', '/api/auth/login', { username: 'admin', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' })).token;

const p = async o => call('POST', '/api/partners', o);
const c1 = await p({ kind: 'customer', name_ar: 'شركة النخبة للفعاليات', name_en: 'Elite Events Co.', vat_number: '310000000000003', cr_number: '1010123456', building_no: '2345', street: 'طريق الأمير سلطان', district: 'الروضة', city: 'جدة', postal_code: '23433' });
const t1 = await p({ kind: 'tenant', name_ar: 'مجمع الألعاب العائلي', name_en: 'Family Play Center', vat_number: '311111111111113', cr_number: '1010654321', building_no: '8812', street: 'شارع التحلية', district: 'السليمانية', city: 'الرياض', postal_code: '12245' });
const t2 = await p({ kind: 'tenant', name_ar: 'أحمد محمد العتيبي', name_en: 'Ahmed Al-Otaibi', national_id: '1000000001', phone: '0500000000', city: 'الرياض' });

const pr1 = await call('POST', '/api/properties', { code: 'P-RYD-01', name_ar: 'مجمع الأعمال التجاري', name_en: 'Business Complex', kind: 'commercial', city: 'الرياض', district: 'العليا', deed_no: '310101000001', branch: 'RYD' });
const pr2 = await call('POST', '/api/properties', { code: 'P-JED-01', name_ar: 'عمارة الشاطئ السكنية', name_en: 'Shatea Residential Building', kind: 'residential', city: 'جدة', district: 'الشاطئ', deed_no: '420202000002', branch: 'JED' });
const u1 = await call('POST', '/api/units', { property_id: pr1.id, unit_no: 'M-01', unit_type: 'floor', area_m2: 180, base_annual_rent: 120000 });
const u2 = await call('POST', '/api/units', { property_id: pr2.id, unit_no: 'A-12', unit_type: 'apartment', area_m2: 120, base_annual_rent: 36000 });
const l1 = await call('POST', '/api/leases', { unit_id: u1.id, tenant_id: t1.id, start_date: '2026-01-01', end_date: '2026-12-31', annual_rent: 120000, payment_freq: 'quarterly', deposit: 10000, ejar_contract_no: 'EJAR-DEMO-1' });
const l2 = await call('POST', '/api/leases', { unit_id: u2.id, tenant_id: t2.id, start_date: '2026-01-01', end_date: '2026-12-31', annual_rent: 36000, payment_freq: 'monthly', deposit: 3000, ejar_contract_no: 'EJAR-DEMO-2' });

// opening capital + bank
await call('POST', '/api/journal', { date: '2026-01-02', memo: 'رأس المال الافتتاحي', lines: [{ account: '1121', debit: 500000 }, { account: '3100', credit: 500000 }] });
// rent invoices for installments due by now
for (const l of [l1, l2]) {
  for (const r of await call('GET', `/api/leases/${l.id}/schedule`)) {
    if (r.due_date <= riyadhToday()) {
      const inv = await call('POST', `/api/rent-schedule/${r.id}/invoice`);
      await call('POST', `/api/invoices/${inv.id}/payments`, { amount: (Number(inv.total) * (r.seq % 3 === 0 ? 0.5 : 1)).toFixed(2), cash_account: '1121', method: 'bank transfer' });
    }
  }
}
// toy sales (simplified + standard) and an after-sales service invoice
const s1 = await call('POST', '/api/invoices', { kind: 'standard', partner_id: c1.id, branch: 'JED', due_date: '2026-12-31', lines: [{ description: 'بيع ألعاب نطيط (5 قطع)', qty: 5, unit_price: 800, tax_code: 'S15', revenue_account: '4200' }] });
await call('POST', `/api/invoices/${s1.id}/payments`, { amount: '2000.00', cash_account: '1121' });
await call('POST', '/api/invoices', { kind: 'simplified', branch: 'RYD', lines: [{ description: 'سيارة تحكم عن بعد', qty: 2, unit_price: 550, tax_code: 'S15', revenue_account: '4200' }] });
await call('POST', '/api/invoices', { kind: 'standard', partner_id: c1.id, branch: 'RYD', lines: [{ description: 'صيانة وما بعد البيع', qty: 1, unit_price: 1500, tax_code: 'S15', revenue_account: '4300' }] });
const toCredit = await call('POST', '/api/invoices', { kind: 'standard', partner_id: c1.id, branch: 'RYD', lines: [{ description: 'بيع ألعاب (مرتجع جزئي لاحقاً)', qty: 1, unit_price: 400, tax_code: 'S15', revenue_account: '4200' }] });
await call('POST', '/api/invoices', { kind: 'credit', related_invoice_id: toCredit.id, reason: 'مرتجع بضاعة تالفة', branch: 'RYD' });
// expenses incl. input VAT and a USD supplier invoice
for (const [d, memo, exp, amt, bank] of [['2026-02-05', 'رواتب فبراير', '5200', 18000, '1121'], ['2026-03-05', 'رواتب مارس', '5200', 18000, '1121'], ['2026-02-10', 'كهرباء ومياه', '5400', 2300, '1121']])
  await call('POST', '/api/journal', { date: d, memo, branch: 'RYD', lines: [{ account: exp, debit: amt }, { account: bank, credit: amt }] });
await call('POST', '/api/journal', { date: '2026-03-12', memo: 'شراء مواد خام من مورد بالدولار (USD 1,000 @ 3.75) + ضريبة مدخلات 15%', branch: 'RYD',
  lines: [{ account: '1140', debit: 1000, currency: 'USD' }, { account: '1150', debit: 150, currency: 'USD' }, { account: '2120', credit: 1150, currency: 'USD' }] });
const v1 = await p({ kind: 'vendor', name_ar: 'شركة الألعاب الحديثة', name_en: 'Modern Toys Co.', vat_number: '320000000000003', cr_number: '1010999999', city: 'الدمام' });
const b1 = await call('POST', '/api/bills', { vendor_id: v1.id, supplier_ref: 'MT-1001', bill_date: '2026-03-15', due_date: '2026-04-15', account: '1140', net: '12000.00', vat_rate: 15, branch: 'RYD', memo: 'شراء ألعاب للمخزون' });
await call('POST', `/api/bills/${b1.id}/payments`, { amount: '5000.00', date: '2026-03-20', cash_account: '1121', method: 'bank' });
// owners of the demo properties (الملاك)
const ow1 = await call('POST', '/api/owners', { kind: 'individual', name_ar: 'مالك تجريبي', national_id: '1000000002', phone: '0500000009', iban: 'SA0380000000608010167519' });
await call('PUT', `/api/properties/${pr1.id}/owners`, { owners: [{ owner_id: ow1.id, share_pct: 100 }] });
await call('PUT', `/api/properties/${pr2.id}/owners`, { owners: [{ owner_id: ow1.id, share_pct: 60 }] });
// the demo store, products, stock and technicians come from db/init/130_demo_catalog.sql
console.log('Demo data loaded.');
