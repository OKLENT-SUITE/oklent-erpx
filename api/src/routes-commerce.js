// Stores, storefront, products/offers, POS, online orders, bank transfers, quick finance, sales reports, user admin.
import { applySiteDefaults, readiness, isMoney, money } from './site-defaults.js';
import { riyadhToday } from './dates.js';
import { assertPasswordPolicy } from './security.js';
import { isMultiTenant, currentTenant } from './tenancy.js';
import { validateImage, saveProductImage, removeUpload, isOwnUpload } from './uploads.js';
const RANK = { viewer: 1, cashier: 2, accountant: 3, admin: 4 };
const bucket = new Map();   // naive in-memory rate limiter (per process). Use a reverse proxy / Redis limiter when scaling out.
const LIMIT = process.env.NODE_ENV === 'production' ? 0 : (Number(process.env.PUBLIC_RATE_LIMIT_MAX) || 0);   // tests only: raises the public order/booking limits. Really ignored in production (SEC-03); the production guard also refuses to start if it is set
function limited(key, max, windowMs) {
  if (LIMIT && /^[ob]:/.test(key)) max = LIMIT;
  if (process.env.NODE_ENV !== 'production' && /^[ob]:/.test(key)) max = Math.max(max, 500);
  const now = Date.now(); const a = (bucket.get(key) || []).filter(t => now - t < windowMs);
  if (a.length >= max) { bucket.set(key, a); return true; } a.push(now); bucket.set(key, a); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of bucket) if (!v.some(t => now - t < 600000)) bucket.delete(k); }, 300000).unref();

export function registerCommerce({ app, route, auth, q, tx, issueInvoice, httpErr, UPLOAD_DIR, idempotent }) {
  const dateOr = (v, d) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : d);
  const today = () => riyadhToday();
  const scope = () => (isMultiTenant() ? currentTenant()?.slug || null : null);   // tenant folder for uploaded files (null = single-company layout)
  const must = (b, ...keys) => { for (const k of keys) if (b?.[k] === undefined || b[k] === '') throw httpErr(400, `${k} is required`); };
  const storeOf = async (id, feature) => {
    const { rows: [s] } = await q('SELECT s.*, b.code branch_code FROM stores s LEFT JOIN branches b ON b.id=s.branch_id WHERE s.id=$1 AND s.is_active', [id]);
    if (!s) throw httpErr(404, 'store not found');
    if (feature && !s.features.includes(feature)) throw httpErr(409, `feature "${feature}" is not enabled for this store`);
    return s;
  };

  // security headers (nosniff, frame-deny, referrer policy, CSP for HTML) are set once, in server.js

  // ---- store settings ----
  route('GET', '/api/commerce-types', 'viewer', async () => ({
    types: (await q('SELECT * FROM commerce_types ORDER BY code')).rows, features: (await q('SELECT * FROM commerce_features ORDER BY code')).rows }));
  route('GET', '/api/stores', 'viewer', async () => (await q(`SELECT s.*, b.name_ar branch, w.is_published, w.title_ar FROM stores s LEFT JOIN branches b ON b.id=s.branch_id LEFT JOIN store_site w ON w.store_id=s.id ORDER BY s.id`)).rows);
  route('POST', '/api/stores', 'admin', async req => { const b = req.body || {}; must(b, 'code', 'slug', 'name_ar', 'commerce_type');
    return tx(req.user.username, async c => { const { rows: [s] } = await c.query(
      `INSERT INTO stores(code,slug,name_ar,name_en,branch_id,commerce_type,features) VALUES ($1,$2,$3,$4,(SELECT id FROM branches WHERE code=$5),$6,coalesce($7::text[],'{}')) RETURNING *`,
      [b.code, b.slug, b.name_ar, b.name_en, b.branch, b.commerce_type, b.features]);
      await c.query('INSERT INTO store_site(store_id,title_ar) VALUES ($1,$2)', [s.id, b.name_ar]); await applySiteDefaults(c, s.id, { overwrite: true }); return s; }); });
  route('PUT', '/api/stores/:id', 'admin', async req => { const b = req.body || {}; return tx(req.user.username, async c => { const row = (await c.query(
    `UPDATE stores SET name_ar=coalesce($2,name_ar), commerce_type=coalesce($3,commerce_type), features=coalesce($4::text[],features), is_active=coalesce($5,is_active),
       branch_id=coalesce((SELECT id FROM branches WHERE code=$6),branch_id) WHERE id=$1 RETURNING *`, [req.params.id, b.name_ar, b.commerce_type, b.features, b.is_active, b.branch])).rows[0]; if (row) await applySiteDefaults(c, row.id); return row; }); });
  route('GET', '/api/stores/:id/site', 'viewer', async req => (await q('SELECT * FROM store_site WHERE store_id=$1', [req.params.id])).rows[0] || {});
  route('PUT', '/api/stores/:id/site', 'admin', async req => { const b = req.body || {};
    for (const k of ['delivery_fee', 'free_delivery_over', 'min_order']) if (!isMoney(b[k])) throw httpErr(400, `${k} must be a number with at most 2 decimals`);
    if (b.payment_methods !== undefined && !Array.isArray(b.payment_methods)) throw httpErr(400, 'payment_methods must be a list');
    return tx(req.user.username, async c => (await c.query(
      `INSERT INTO store_site(store_id,title_ar,tagline_ar,about_ar,return_policy_ar,theme_color,phone,whatsapp,email,is_published,payment_methods,delivery_fee,free_delivery_over,min_order)
       VALUES ($1,$2,$3,$4,$5,coalesce($6,'#14B8A6'),$7,$8,$9,coalesce($10,false),coalesce($11::text[],'{cod}'),coalesce($12::numeric,0),$13::numeric,coalesce($14::numeric,0))
       ON CONFLICT (store_id) DO UPDATE SET title_ar=EXCLUDED.title_ar, tagline_ar=EXCLUDED.tagline_ar, about_ar=EXCLUDED.about_ar, return_policy_ar=EXCLUDED.return_policy_ar,
         theme_color=EXCLUDED.theme_color, phone=EXCLUDED.phone, whatsapp=EXCLUDED.whatsapp, email=EXCLUDED.email, is_published=EXCLUDED.is_published,
         payment_methods=EXCLUDED.payment_methods, delivery_fee=EXCLUDED.delivery_fee, free_delivery_over=EXCLUDED.free_delivery_over, min_order=EXCLUDED.min_order RETURNING *`,
      [req.params.id, b.title_ar, b.tagline_ar, b.about_ar, b.return_policy_ar, b.theme_color, b.phone, b.whatsapp, b.email, b.is_published, b.payment_methods, b.delivery_fee === '' ? null : b.delivery_fee, b.free_delivery_over === '' || b.free_delivery_over === undefined ? null : b.free_delivery_over, b.min_order === '' ? null : b.min_order])).rows[0]); });

  route('GET', '/api/stores/:id/readiness', 'viewer', async req => { const r = await readiness(q, req.params.id); if (!r) throw httpErr(404, 'store not found'); return r; });
  route('POST', '/api/stores/:id/site/defaults', 'admin', async req => tx(req.user.username, async c => {
    const r = await applySiteDefaults(c, req.params.id, { overwrite: req.body?.overwrite === true }); if (!r.site) throw httpErr(404, 'store not found'); return { changed: r.changed, site: r.site }; }));

  // ---- products & offers ----
  route('GET', '/api/products', 'viewer', async () => (await q(`SELECT p.*, a.code revenue_account, fn_unit_discount(p.id,NULL,current_date) unit_discount FROM products p JOIN accounts a ON a.id=p.revenue_account_id ORDER BY p.id DESC LIMIT 1000`)).rows);
  route('POST', '/api/products', 'accountant', async req => { const b = req.body || {}; must(b, 'sku', 'name_ar', 'sale_price');
    return tx(req.user.username, async c => (await c.query(
      `INSERT INTO products(sku,name_ar,name_en,kind,category,unit,sale_price,cost_price,tax_code,stock_tracked,published,description_ar,image_url)
       VALUES ($1,$2,$3,coalesce($4,'goods'),$5,coalesce($6,'قطعة'),$7::numeric,coalesce($8::numeric,0),coalesce($9,'S15'),coalesce($10,false),coalesce($11,false),$12,$13) RETURNING *`,
      [b.sku, b.name_ar, b.name_en, b.kind, b.category, b.unit, b.sale_price, b.cost_price, b.tax_code, b.stock_tracked, b.published, b.description_ar, b.image_url || null]).then(async r => {
        const p = r.rows[0];
        if (p.stock_tracked && Number(b.opening_qty) > 0) await c.query(`SELECT stock_move($1,$2,$3,'opening','opening',NULL,$4)`, [p.id, b.store_id || (await c.query('SELECT min(id) id FROM stores')).rows[0].id, b.opening_qty, req.user.username]);
        return r; })).rows[0]); });
  route('PUT', '/api/products/:id', 'accountant', async req => { const b = req.body || {};
    if (!isMoney(b.sale_price)) throw httpErr(400, 'sale_price must be a number with at most 2 decimals');
    return tx(req.user.username, async c => {
      const { rows: [cur] } = await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [req.params.id]); if (!cur) throw httpErr(404, 'product not found');
      if (b.stock_tracked === false && cur.stock_tracked) { const { rows: [h] } = await c.query('SELECT coalesce(sum(qty),0) h FROM stock_moves WHERE product_id=$1', [cur.id]); if (Number(h.h) !== 0) throw httpErr(409, 'لا يمكن إيقاف تتبع المخزون والرصيد غير صفر؛ سوِّ الرصيد إلى صفر أولاً'); }
      if (b.stock_tracked === true && cur.kind !== 'goods') throw httpErr(409, 'تتبع المخزون للبضاعة فقط (ليس للخدمات أو التأجير)');
      const r = (await c.query(
        `UPDATE products SET name_ar=coalesce($2,name_ar), sale_price=coalesce($3::numeric,sale_price), published=coalesce($4,published), is_active=coalesce($5,is_active),
           category=coalesce($6,category), image_url=coalesce($7,image_url), description_ar=coalesce($8,description_ar), stock_tracked=coalesce($9,stock_tracked), allow_negative=coalesce($10,allow_negative) WHERE id=$1 RETURNING *`,
        [req.params.id, b.name_ar, b.sale_price === '' ? null : b.sale_price, b.published, b.is_active, b.category, b.image_url, b.description_ar, b.stock_tracked, b.allow_negative])).rows[0];
      if (b.stock_tracked === true && !cur.stock_tracked && Number(b.opening_qty) > 0) await c.query(`SELECT stock_move($1,$2,$3,'opening','opening',NULL,$4)`, [r.id, b.store_id || (await c.query('SELECT min(id) id FROM stores')).rows[0].id, b.opening_qty, req.user.username]);
      return r; }); });
  // Product image: raw body (image/jpeg|png|webp, <= 2 MB). Auth runs in onRequest so an anonymous caller never gets its body buffered.
  // Order: validate bytes -> write file -> UPDATE row (locked) -> delete the previous upload. If the UPDATE fails the new file is removed (no orphan, no dangling path).
  app.route({ method: 'POST', url: '/api/products/:id/image', onRequest: auth('accountant'), handler: async req => {
    const t = validateImage(req.body, req.headers['content-type']); const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw httpErr(400, 'invalid product id');
    if (!(await q('SELECT 1 FROM products WHERE id=$1', [id])).rows.length) throw httpErr(404, 'product not found');
    const url = await saveProductImage(req.body, UPLOAD_DIR, scope()); let old;
    try { old = await tx(req.user.username, async c => { const { rows: [cur] } = await c.query('SELECT image_url FROM products WHERE id=$1 FOR UPDATE', [id]); if (!cur) throw httpErr(404, 'product not found');
        await c.query('UPDATE products SET image_url=$2 WHERE id=$1', [id, url]); return cur.image_url; }); }
    catch (e) { await removeUpload(url, UPLOAD_DIR, scope()); throw e; }
    if (old && old !== url) await removeUpload(old, UPLOAD_DIR, scope());
    return { id, image_url: url, type: t.mime, bytes: req.body.length }; } });
  route('DELETE', '/api/products/:id/image', 'accountant', async req => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw httpErr(400, 'invalid product id');
    const old = await tx(req.user.username, async c => { const { rows: [cur] } = await c.query('SELECT image_url FROM products WHERE id=$1 FOR UPDATE', [id]); if (!cur) throw httpErr(404, 'product not found');
      await c.query('UPDATE products SET image_url=NULL WHERE id=$1', [id]); return cur.image_url; });
    if (isOwnUpload(old, scope())) await removeUpload(old, UPLOAD_DIR, scope()); return { id, image_url: null }; });
  route('GET', '/api/offers', 'viewer', async () => (await q(`SELECT o.*, p.name_ar product FROM offers o LEFT JOIN products p ON p.id=o.product_id ORDER BY o.id DESC`)).rows);
  route('POST', '/api/offers', 'accountant', async req => { const b = req.body || {}; must(b, 'code', 'name_ar', 'discount_type', 'value', 'start_date', 'end_date');
    return tx(req.user.username, async c => (await c.query(
      `INSERT INTO offers(code,name_ar,product_id,store_id,discount_type,value,start_date,end_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.code, b.name_ar, b.product_id || null, b.store_id || null, b.discount_type, b.value, b.start_date, b.end_date])).rows[0]); });
  route('PUT', '/api/offers/:id', 'accountant', async req => tx(req.user.username, async c => (await c.query('UPDATE offers SET is_active=$2 WHERE id=$1 RETURNING *', [req.params.id, !!req.body?.is_active])).rows[0]));

  // ---- POS: price, discount and VAT come from the DB; invoice + receipt are ONE transaction ----
  route('POST', '/api/pos/sale', 'cashier', async req => {
    const b = req.body || {}; must(b, 'store_id'); const s = await storeOf(b.store_id, 'pos');
    if (!Array.isArray(b.lines) || !b.lines.length) throw httpErr(400, 'cart is empty');
    const method = b.method === 'card' ? 'card' : 'cash', acct = method === 'card' ? '1122' : '1110';
    const lines = [], moves = [];
    for (const l of b.lines) {
      const qty = Number(l.qty); if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw httpErr(400, 'qty must be 1..999');
      const { rows: [p] } = await q(`SELECT p.*, a.code rev, round($2::int*fn_unit_discount(p.id,$3,current_date),2) disc FROM products p JOIN accounts a ON a.id=p.revenue_account_id WHERE p.id=$1 AND p.is_active`, [l.product_id, qty, s.id]);
      if (!p) throw httpErr(400, `product ${l.product_id} unavailable`);
      lines.push({ description: p.name_ar, qty, unit_price: p.sale_price, discount: p.disc, tax_code: p.tax_code, revenue_account: p.rev }); if (p.stock_tracked) moves.push([p.id, qty]);
    }
    return issueInvoice(req.user.username, { kind: 'simplified', partner_id: b.partner_id || undefined, branch: s.branch_code, lines },
      async (c, id, inv) => { await c.query(`SELECT record_payment($1,$2,(now() AT TIME ZONE 'Asia/Riyadh')::date,$3,$4,$5)`, [id, inv.total, acct, 'pos-' + method, req.user.username]);
        for (const [pid, qty] of moves) await c.query(`SELECT stock_move($1,$2,$3,'sale',$4,NULL,$5)`, [pid, s.id, -qty, inv.number, req.user.username]); });
  });

  // ---- online orders (back office) ----
  route('GET', '/api/orders', 'viewer', async req => (await q(`SELECT o.*, s.name_ar store, i.number invoice_no FROM online_orders o JOIN stores s ON s.id=o.store_id LEFT JOIN invoices i ON i.id=o.invoice_id
    WHERE ($1::text IS NULL OR o.status=$1) ORDER BY o.id DESC LIMIT 300`, [req.query.status || null])).rows);
  route('GET', '/api/orders/:id', 'viewer', async req => { const { rows: [o] } = await q('SELECT * FROM online_orders WHERE id=$1', [req.params.id]); if (!o) throw httpErr(404, 'not found');
    o.lines = (await q('SELECT * FROM online_order_lines WHERE order_id=$1 ORDER BY id', [o.id])).rows; return o; });
  route('POST', '/api/orders/:id/status', 'cashier', async req => tx(req.user.username, async c => { await c.query('SELECT set_order_status($1,$2,$3)', [req.params.id, req.body?.status, req.user.username]); return { ok: true }; }));
  route('POST', '/api/orders/:id/invoice', 'accountant', async req => {
    const { rows: [o] } = await q(`SELECT o.*, b.code branch FROM online_orders o JOIN stores s ON s.id=o.store_id LEFT JOIN branches b ON b.id=s.branch_id WHERE o.id=$1`, [req.params.id]);
    if (!o) throw httpErr(404, 'not found'); if (o.invoice_id) throw httpErr(409, 'already invoiced'); if (o.status === 'cancelled') throw httpErr(409, 'order is cancelled');
    const rows = (await q('SELECT l.*, p.stock_tracked FROM online_order_lines l LEFT JOIN products p ON p.id=l.product_id WHERE l.order_id=$1 ORDER BY l.id', [o.id])).rows;
    const lines = rows.map(r => ({ description: r.description, qty: r.qty, unit_price: r.unit_price, discount: r.discount, tax_code: r.tax_code, revenue_account: r.revenue_account }));
    return issueInvoice(req.user.username, { kind: 'simplified', partner_id: o.partner_id, branch: o.branch, lines }, async (c, id, inv) => {
      await c.query('SELECT link_order_invoice($1,$2,$3)', [o.id, id, req.user.username]);
      for (const r of rows) if (r.stock_tracked) await c.query(`SELECT stock_move($1,$2,$3,'sale',$4,NULL,$5)`, [r.product_id, o.store_id, -Number(r.qty), inv.number, req.user.username]); });
  });

  // ---- bank transfers (الحوالات) ----
  route('GET', '/api/transfers', 'viewer', async req => (await q(`SELECT t.*, p.name_ar partner, i.number invoice_no FROM bank_transfers t LEFT JOIN partners p ON p.id=t.partner_id LEFT JOIN invoices i ON i.id=t.invoice_id
    WHERE ($1::text IS NULL OR t.status=$1) ORDER BY t.id DESC LIMIT 300`, [req.query.status || null])).rows);
  route('POST', '/api/transfers', 'cashier', async req => { const b = req.body || {}; must(b, 'reference', 'transfer_date', 'amount');
    return tx(req.user.username, async c => (await c.query(`INSERT INTO bank_transfers(reference,transfer_date,partner_id,amount,bank_account,note,created_by) VALUES ($1,$2,$3,$4,coalesce($5,'1121'),$6,$7) RETURNING *`,
      [b.reference, b.transfer_date, b.partner_id || null, b.amount, b.bank_account, b.note, req.user.username])).rows[0]); });
  route('GET', '/api/transfers/:id/candidates', 'viewer', async req => (await q(`SELECT i.id, i.number, p.name_ar partner, fn_invoice_outstanding(i.id) outstanding FROM invoices i LEFT JOIN partners p ON p.id=i.partner_id
    WHERE i.kind<>'credit' AND fn_invoice_outstanding(i.id) > 0 AND ((SELECT partner_id FROM bank_transfers WHERE id=$1) IS NOT DISTINCT FROM i.partner_id OR (SELECT partner_id FROM bank_transfers WHERE id=$1) IS NULL)
    ORDER BY (fn_invoice_outstanding(i.id) = (SELECT amount FROM bank_transfers WHERE id=$1)) DESC, i.id DESC LIMIT 50`, [req.params.id])).rows);
  route('POST', '/api/transfers/:id/confirm', 'accountant', async req => tx(req.user.username, async c => ({ entry_id: (await c.query('SELECT confirm_transfer($1,$2,$3) id', [req.params.id, req.body?.invoice_id, req.user.username])).rows[0].id })));
  route('POST', '/api/transfers/:id/reject', 'accountant', async req => tx(req.user.username, async c => { await c.query('SELECT reject_transfer($1,$2,$3)', [req.params.id, req.user.username, req.body?.reason]); return { ok: true }; }));

  // ---- quick expense / other revenue (posts a normal, balanced, VAT-aware journal entry) ----
  route('POST', '/api/finance/quick', 'accountant', async req => {
    const b = req.body || {}; must(b, 'kind', 'account', 'amount', 'pay_account', 'memo');
    if (!['expense', 'revenue'].includes(b.kind)) throw httpErr(400, 'kind must be expense|revenue');
    const rate = b.vat_rate === 15 || b.vat_rate === '15' ? 15 : 0;
    const { rows: [x] } = await q(`SELECT $1::numeric net, round($1::numeric*$2/100,2) vat`, [b.amount, rate]);
    const total = (await q('SELECT ($1::numeric+$2::numeric)::text t', [x.net, x.vat])).rows[0].t;
    const lines = b.kind === 'expense'
      ? [{ account: b.account, debit: x.net, memo: b.memo }, ...(+x.vat ? [{ account: '1150', debit: x.vat, memo: 'VAT input' }] : []), { account: b.pay_account, credit: total, partner_id: b.partner_id }]
      : [{ account: b.pay_account, debit: total, partner_id: b.partner_id }, { account: b.account, credit: x.net, memo: b.memo }, ...(+x.vat ? [{ account: '2110', credit: x.vat, memo: 'VAT output' }] : [])];
    return tx(req.user.username, async c => ({ id: (await c.query('SELECT post_entry($1,$2,$3,$4,$5,$6,$7::jsonb) id',
      [dateOr(b.date, today()), b.memo, b.branch || null, b.kind, null, req.user.username, JSON.stringify(lines)])).rows[0].id }));
  });
  route('GET', '/api/finance/quick', 'viewer', async () => (await q(`SELECT e.id, e.entry_no, e.entry_date, e.memo, e.source_type, e.total_base, b.name_ar branch FROM journal_entries e LEFT JOIN branches b ON b.id=e.branch_id
    WHERE e.source_type IN ('expense','revenue') ORDER BY e.id DESC LIMIT 100`)).rows);

  // ---- sales reports ----
  const GROUPS = { month: "to_char(i.issue_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM')", branch: "coalesce(b.name_ar,'—')", segment: 'a.name_ar', customer: "coalesce(p.name_ar,'عميل نقدي')" };
  route('GET', '/api/reports/sales', 'viewer', async req => {
    const g = GROUPS[req.query.group] || GROUPS.month;    // whitelisted expression, never user text
    return (await q(`SELECT ${g} AS k, sum(CASE WHEN i.kind='credit' THEN -il.net ELSE il.net END) net, sum(CASE WHEN i.kind='credit' THEN -il.vat ELSE il.vat END) vat, count(DISTINCT i.id) invoices
      FROM invoices i JOIN invoice_lines il ON il.invoice_id=i.id JOIN accounts a ON a.id=il.revenue_account_id LEFT JOIN branches b ON b.id=i.branch_id LEFT JOIN partners p ON p.id=i.partner_id
      WHERE (i.issue_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [dateOr(req.query.from, today().slice(0, 4) + '-01-01'), dateOr(req.query.to, today())])).rows;
  });
  route('GET', '/api/reports/sales/details', 'viewer', async req => (await q(`
    SELECT i.id, i.number AS invoice_no, (i.issue_at AT TIME ZONE 'Asia/Riyadh')::date AS issue_date,
           coalesce(p.name_ar, 'عميل نقدي') AS customer, coalesce(b.name_ar, '—') AS branch, i.kind,
           sum(CASE WHEN i.kind='credit' THEN -il.net ELSE il.net END) AS net,
           sum(CASE WHEN i.kind='credit' THEN -il.vat ELSE il.vat END) AS vat,
           sum(CASE WHEN i.kind='credit' THEN -(il.net + il.vat) ELSE il.net + il.vat END) AS total
    FROM invoices i
    JOIN invoice_lines il ON il.invoice_id=i.id
    LEFT JOIN branches b ON b.id=i.branch_id
    LEFT JOIN partners p ON p.id=i.partner_id
    WHERE (i.issue_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1 AND $2
    GROUP BY i.id, i.number, i.issue_at, p.name_ar, b.name_ar, i.kind
    ORDER BY i.issue_at DESC, i.id DESC
  `, [dateOr(req.query.from, today().slice(0, 4) + '-01-01'), dateOr(req.query.to, today())])).rows);


  // ---- purchases (المشتريات): vendor bills, payments, AP aging, reports ----
  route('GET', '/api/bills', 'viewer', async () => (await q(`SELECT b.*, p.name_ar vendor, a.code account_code, a.name_ar account_name, fn_bill_outstanding(b.id) outstanding FROM vendor_bills b
    JOIN partners p ON p.id=b.vendor_id JOIN accounts a ON a.id=b.account_id ORDER BY b.id DESC LIMIT 300`)).rows);
  route('POST', '/api/bills', 'accountant', async req => { const b = req.body || {}; must(b, 'vendor_id', 'supplier_ref', 'bill_date', 'account', 'net');
    return tx(req.user.username, async c => ({ id: (await c.query('SELECT record_vendor_bill($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id',
      [b.vendor_id, b.supplier_ref, b.bill_date, b.due_date || b.bill_date, b.account, b.net, b.vat_rate === 15 || b.vat_rate === '15' ? 15 : 0, b.branch || null, b.memo, req.user.username])).rows[0].id })); });
  route('POST', '/api/bills/:id/payments', 'accountant', async req => tx(req.user.username, async c => ({ entry_id: (await c.query('SELECT pay_vendor_bill($1,$2,$3,$4,$5,$6) id',
    [req.params.id, req.body?.amount, dateOr(req.body?.date, today()), req.body?.cash_account || '1121', req.body?.method, req.user.username])).rows[0].id })));
  route('GET', '/api/reports/ap-aging', 'viewer', async req => (await q('SELECT * FROM fn_ap_aging($1)', [dateOr(req.query.to, today())])).rows);
  const PG = { month: "to_char(b.bill_date,'YYYY-MM')", vendor: 'p.name_ar', branch: "coalesce(br.name_ar,'—')", account: 'a.name_ar' };
  route('GET', '/api/reports/purchases', 'viewer', async req => (await q(`SELECT ${PG[req.query.group] || PG.month} AS k, sum(b.net) net, sum(b.vat) vat, sum(b.total) total, count(*) bills
    FROM vendor_bills b JOIN partners p ON p.id=b.vendor_id JOIN accounts a ON a.id=b.account_id LEFT JOIN branches br ON br.id=b.branch_id
    WHERE b.bill_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [dateOr(req.query.from, today().slice(0, 4) + '-01-01'), dateOr(req.query.to, today())])).rows);
  route('GET', '/api/reports/purchases/details', 'viewer', async req => (await q(`
    SELECT b.id, b.number AS invoice_no, b.supplier_ref, b.bill_date, p.name_ar AS vendor,
           coalesce(br.name_ar, '—') AS branch, a.code AS account_code, a.name_ar AS account_name,
           b.net, b.vat, b.total, fn_bill_outstanding(b.id) AS outstanding
    FROM vendor_bills b
    JOIN partners p ON p.id=b.vendor_id
    JOIN accounts a ON a.id=b.account_id
    LEFT JOIN branches br ON br.id=b.branch_id
    WHERE b.bill_date BETWEEN $1 AND $2
    ORDER BY b.bill_date DESC, b.id DESC
  `, [dateOr(req.query.from, today().slice(0, 4) + '-01-01'), dateOr(req.query.to, today())])).rows);


  // ---- Saudi geography ----
  route('GET', '/api/geo', 'viewer', async () => ({ regions: (await q('SELECT * FROM sa_regions ORDER BY id')).rows, cities: (await q('SELECT * FROM sa_cities WHERE is_active ORDER BY name_ar')).rows,
    districts: (await q('SELECT * FROM sa_districts ORDER BY name_ar')).rows }));
  route('POST', '/api/geo/cities', 'admin', async req => tx(req.user.username, async c => { const r = (await c.query('INSERT INTO sa_cities(region_id,name_ar,name_en) VALUES ($1,$2,$3) RETURNING *', [req.body?.region_id, req.body?.name_ar, req.body?.name_en])).rows[0];
    await c.query("INSERT INTO sa_districts(city_id,name_ar) VALUES ($1,'أخرى / غير مدرج') ON CONFLICT DO NOTHING", [r.id]); return r; }));
  route('PUT', '/api/geo/cities/:id', 'admin', async req => { const b = req.body || {}; return tx(req.user.username, async c => { const r = await c.query(
    'UPDATE sa_cities SET region_id=coalesce($2,region_id), needs_review=coalesce($3,needs_review), is_active=coalesce($4,is_active) WHERE id=$1 RETURNING *', [req.params.id, b.region_id ?? null, b.needs_review ?? null, b.is_active ?? null]);
    if (!r.rowCount) throw httpErr(404, 'city not found'); return r.rows[0]; }); });
  route('POST', '/api/geo/districts', 'admin', async req => tx(req.user.username, async c => (await c.query('INSERT INTO sa_districts(city_id,name_ar) VALUES ($1,$2) RETURNING *', [req.body?.city_id, req.body?.name_ar])).rows[0]));
  // bulk load of the official list: rows = [{region, city, district}] (region must already exist; unknown cities are created under it)
  route('POST', '/api/geo/import', 'admin', async req => { const rows = req.body?.rows; if (!Array.isArray(rows) || !rows.length || rows.length > 20000) throw httpErr(400, 'rows must be 1..20000');
    return tx(req.user.username, async c => { let cities = 0, districts = 0;
      const regions = (await c.query('SELECT id, name_ar FROM sa_regions')).rows; const nz = x => String(x || '').trim().replace(/^(المنطقه|المنطقة|منطقه|منطقة)\s+/, '').replace(/[أإآ]/g, 'ا').replace(/[ةه]\b/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
      for (const r of rows) { const rg = regions.find(x => x.name_ar === String(r.region || '').trim()) || regions.find(x => nz(x.name_ar) === nz(r.region)); if (!rg) throw httpErr(422, 'unknown region: ' + r.region + ' (use one of: ' + regions.map(x => x.name_ar).join('، ') + ')');
        const city = String(r.city || '').trim(); if (!city) continue;
        const ci = await c.query('INSERT INTO sa_cities(region_id,name_ar) VALUES ($1,$2) ON CONFLICT (name_ar) DO NOTHING RETURNING id', [rg.id, city]); cities += ci.rowCount; if (ci.rowCount) await c.query("INSERT INTO sa_districts(city_id,name_ar) VALUES ($1,'أخرى / غير مدرج') ON CONFLICT DO NOTHING", [ci.rows[0].id]);
        const dn = String(r.district || '').trim(); if (!dn) continue;
        const di = await c.query('INSERT INTO sa_districts(city_id,name_ar) SELECT id,$2 FROM sa_cities WHERE name_ar=$1 ON CONFLICT (city_id,name_ar) DO NOTHING', [city, dn]); districts += di.rowCount; }
      return { cities, districts }; }); });
  app.get('/api/public/geo', async req => { if (limited('g:' + req.ip, 120, 60000)) throw httpErr(429, 'too many requests');
    return { regions: (await q('SELECT id,name_ar FROM sa_regions ORDER BY id')).rows, cities: (await q('SELECT id,region_id,name_ar FROM sa_cities WHERE is_active ORDER BY name_ar')).rows, districts: (await q('SELECT id,city_id,name_ar FROM sa_districts ORDER BY (name_ar LIKE \'أخرى%\'), name_ar')).rows }; });

  // ---- technicians ----
  route('GET', '/api/technicians', 'viewer', async () => (await q(`SELECT t.*, c.name_ar city, rg.name_ar region, b.name_ar branch FROM technicians t LEFT JOIN sa_cities c ON c.id=t.city_id LEFT JOIN sa_regions rg ON rg.id=c.region_id LEFT JOIN branches b ON b.id=t.branch_id ORDER BY t.id`)).rows);
  route('POST', '/api/technicians', 'accountant', async req => { const b = req.body || {}; must(b, 'name_ar', 'phone'); return tx(req.user.username, async c => (await c.query(
    `INSERT INTO technicians(name_ar,phone,city_id,branch_id,specialty) VALUES ($1,$2,$3,(SELECT id FROM branches WHERE code=$4),$5) RETURNING *`, [b.name_ar, b.phone, b.city_id || null, b.branch || null, b.specialty])).rows[0]); });
  route('PUT', '/api/technicians/:id', 'accountant', async req => { const b = req.body || {}; return tx(req.user.username, async c => { const r = await c.query(
    'UPDATE technicians SET name_ar=coalesce($2,name_ar), phone=coalesce($3,phone), city_id=CASE WHEN $4::boolean THEN $5::int ELSE city_id END, specialty=coalesce($6,specialty), is_active=coalesce($7,is_active) WHERE id=$1 RETURNING *',
    [req.params.id, b.name_ar || null, b.phone || null, 'city_id' in b, b.city_id || null, b.specialty ?? null, typeof b.is_active === 'boolean' ? b.is_active : null]); if (!r.rowCount) throw httpErr(404, 'technician not found'); return r.rows[0]; }); });
  // who is free? active technicians for a booking at a given slot (same-city first, busy ones flagged)
  route('GET', '/api/bookings/:id/technicians', 'viewer', async req => { const { rows: [k] } = await q('SELECT id, city_id, scheduled_at, duration_minutes FROM bookings WHERE id=$1', [req.params.id]); if (!k) throw httpErr(404, 'not found');
    const date = dateOr(req.query.date, String(k.scheduled_at).slice(0, 10)), time = /^\d{2}:\d{2}$/.test(req.query.time || '') ? req.query.time : String(k.scheduled_at).slice(11, 16), mins = Math.min(720, Math.max(30, Number(req.query.duration) || k.duration_minutes));
    return (await q(`SELECT t.id, t.name_ar, t.phone, t.specialty, c.name_ar city, (t.city_id IS NOT DISTINCT FROM $2) same_city,
        EXISTS (SELECT 1 FROM bookings b WHERE b.technician_id=t.id AND b.id<>$1 AND b.status IN ('confirmed','in_progress') AND tsrange(b.scheduled_at, b.scheduled_end) && tsrange($3::timestamp, $3::timestamp + make_interval(mins => $4::int))) busy
      FROM technicians t LEFT JOIN sa_cities c ON c.id=t.city_id WHERE t.is_active ORDER BY (t.city_id IS NOT DISTINCT FROM $2) DESC, t.name_ar`, [k.id, k.city_id, `${date} ${time}`, mins])).rows; });

  // ---- bookings (الحجوزات) ----
  route('GET', '/api/bookings', 'viewer', async req => (await q(`SELECT k.*, rg.name_ar region, c.name_ar city, d.name_ar district, t.name_ar technician, s.name_ar store, i.number invoice_no
    FROM bookings k JOIN sa_cities c ON c.id=k.city_id JOIN sa_regions rg ON rg.id=c.region_id JOIN sa_districts d ON d.id=k.district_id JOIN stores s ON s.id=k.store_id LEFT JOIN technicians t ON t.id=k.technician_id LEFT JOIN invoices i ON i.id=k.invoice_id
    WHERE ($1::text IS NULL OR k.status=$1) ORDER BY k.scheduled_at DESC LIMIT 300`, [req.query.status || null])).rows);
  route('GET', '/api/bookings/:id', 'viewer', async req => { const { rows: [k] } = await q(`SELECT k.*, rg.name_ar region, c.name_ar city, d.name_ar district, t.name_ar technician FROM bookings k JOIN sa_cities c ON c.id=k.city_id JOIN sa_regions rg ON rg.id=c.region_id JOIN sa_districts d ON d.id=k.district_id LEFT JOIN technicians t ON t.id=k.technician_id WHERE k.id=$1`, [req.params.id]);
    if (!k) throw httpErr(404, 'not found'); k.lines = (await q('SELECT * FROM booking_lines WHERE booking_id=$1 ORDER BY id', [k.id])).rows; return k; });
  route('POST', '/api/bookings/:id/assign', 'cashier', async req => { const b = req.body || {}; must(b, 'technician_id', 'date', 'time');
    return tx(req.user.username, async c => { await c.query('SELECT assign_booking($1,$2,$3::timestamp,$4,$5)', [req.params.id, b.technician_id, `${b.date} ${b.time}`, b.duration || null, req.user.username]); return { ok: true }; }); });
  route('POST', '/api/bookings/:id/status', 'cashier', async req => tx(req.user.username, async c => { await c.query('SELECT set_booking_status($1,$2,$3)', [req.params.id, req.body?.status, req.user.username]); return { ok: true }; }));
  route('PUT', '/api/bookings/:id/billing', 'cashier', async req => tx(req.user.username, async c => { await c.query('SELECT update_booking_billing($1,$2::jsonb,$3)', [req.params.id, JSON.stringify(req.body || {}), req.user.username]); return { ok: true }; }));
  route('POST', '/api/bookings/:id/invoice', 'accountant', async req => {
    const { rows: [k] } = await q(`SELECT k.*, st.branch_id, br.code branch FROM bookings k JOIN stores st ON st.id=k.store_id LEFT JOIN branches br ON br.id=st.branch_id WHERE k.id=$1`, [req.params.id]);
    if (!k) throw httpErr(404, 'not found'); if (k.invoice_id) throw httpErr(409, 'already invoiced'); if (k.status !== 'completed') throw httpErr(409, 'complete the booking first');
    const std = !!k.buyer_vat;
    if (std) { const need = { buyer_name: 'اسم المشتري', bill_street: 'الشارع', bill_building_no: 'رقم المبنى', bill_district: 'الحي', bill_city: 'المدينة', bill_postal_code: 'الرمز البريدي' }; const miss = Object.entries(need).filter(([f]) => !k[f]).map(([, l]) => l);
      if (miss.length) throw httpErr(422, 'بيانات الفاتورة الضريبية ناقصة: ' + miss.join('، ')); }
    // Standard (B2B) invoice: the buyer is the company identified by its VAT number. We reuse that partner (or create it) and NEVER overwrite the customer
    // matched by phone. Simplified invoice: the booking's own customer, unchanged.
    const partnerId = await tx(req.user.username, async c => { let id = k.partner_id;
      if (std) {
        id = (await c.query('SELECT id FROM partners WHERE vat_number=$1 ORDER BY id LIMIT 1', [k.buyer_vat])).rows[0]?.id;
        if (id) await c.query(`UPDATE partners SET cr_number=coalesce($2,cr_number), street=coalesce($3,street), building_no=coalesce($4,building_no), district=coalesce($5,district), city=coalesce($6,city), postal_code=coalesce($7,postal_code) WHERE id=$1`,
          [id, k.buyer_cr, k.bill_street, k.bill_building_no, k.bill_district, k.bill_city, k.bill_postal_code]);
        else id = (await c.query(`INSERT INTO partners(kind,name_ar,vat_number,cr_number,phone,street,building_no,district,city,postal_code) VALUES ('customer',$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [k.buyer_name || k.customer_name, k.buyer_vat, k.buyer_cr, k.phone, k.bill_street, k.bill_building_no, k.bill_district, k.bill_city, k.bill_postal_code])).rows[0].id;
      }
      return id; });
    const lines = (await q('SELECT description, qty, unit_price, discount, tax_code, revenue_account FROM booking_lines WHERE booking_id=$1 ORDER BY id', [k.id])).rows;
    // product add-ons (goods) that track stock leave the warehouse in the same transaction as the invoice
    const moves = (await q('SELECT l.product_id, l.qty FROM booking_lines l JOIN products p ON p.id=l.product_id WHERE l.booking_id=$1 AND p.kind=\'goods\' AND p.stock_tracked', [k.id])).rows;
    return issueInvoice(req.user.username, { kind: std ? 'standard' : 'simplified', partner_id: partnerId, branch: k.branch, supply_date: String(k.scheduled_at).slice(0, 10), due_date: today(), lines },
      async (c, id, inv) => { await c.query('SELECT link_booking_invoice($1,$2,$3,$4)', [k.id, id, partnerId, req.user.username]);
        for (const mv of moves) await c.query(`SELECT stock_move($1,$2,$3,'sale',$4,NULL,$5)`, [mv.product_id, k.store_id, -Number(mv.qty), inv.number, req.user.username]); });
  });
  app.post('/api/public/bookings', async (req, reply) => {
    if (limited('b:' + req.ip, 10, 600000)) throw httpErr(429, 'too many bookings, try later');
    const b = req.body || {};
    return idempotent({ q, httpErr, req, reply, scope: 'booking', fn: async () => {
      const { rows: [r] } = await q('SELECT * FROM place_booking($1,$2::jsonb,$3::jsonb,$4::jsonb)', [b.slug, JSON.stringify(b.customer || {}), JSON.stringify(b.when || {}), JSON.stringify(b.lines || [])]);
      return { number: r.number, total: r.total };
    } });
  });

  // ---- owners (الملاك) ----
  route('GET', '/api/owners', 'viewer', async () => (await q(`SELECT o.*, (SELECT string_agg(p.name_ar || ' (' || po.share_pct || '%)', '، ') FROM property_ownership po JOIN properties p ON p.id=po.property_id WHERE po.owner_id=o.id) properties FROM owners o ORDER BY o.id DESC`)).rows);
  route('POST', '/api/owners', 'accountant', async req => { const b = req.body || {}; must(b, 'name_ar'); return tx(req.user.username, async c => (await c.query(
    `INSERT INTO owners(kind,name_ar,name_en,national_id,cr_number,vat_number,phone,email,iban,address) VALUES (coalesce($1,'individual'),$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.kind, b.name_ar, b.name_en, b.national_id, b.cr_number, b.vat_number || null, b.phone, b.email, b.iban || null, b.address])).rows[0]); });
  route('PUT', '/api/owners/:id', 'accountant', async req => tx(req.user.username, async c => (await c.query('UPDATE owners SET is_active=$2 WHERE id=$1 RETURNING *', [req.params.id, !!req.body?.is_active])).rows[0]));
  route('GET', '/api/properties/:id/owners', 'viewer', async req => (await q('SELECT po.*, o.name_ar FROM property_ownership po JOIN owners o ON o.id=po.owner_id WHERE property_id=$1 ORDER BY o.name_ar', [req.params.id])).rows);
  route('PUT', '/api/properties/:id/owners', 'accountant', async req => tx(req.user.username, async c => {
    await c.query('DELETE FROM property_ownership WHERE property_id=$1', [req.params.id]);
    for (const o of req.body?.owners || []) await c.query('INSERT INTO property_ownership(property_id,owner_id,share_pct) VALUES ($1,$2,$3)', [req.params.id, o.owner_id, o.share_pct]);
    return { ok: true }; }));

  // ---- stock: quantities valued at MOVING AVERAGE COST (see db/init/200_inventory_costing_invoice_lines.sql) ----
  route('GET', '/api/stock/unvalued', 'viewer', async () => (await q(`SELECT p.id,p.sku,p.name_ar,p.cost_price,c.qty on_hand,c.avg_cost
    FROM products p JOIN product_costing c ON c.product_id=p.id WHERE p.stock_tracked AND p.is_active AND c.qty>0 AND c.avg_cost<=0 ORDER BY p.name_ar,p.sku`)).rows);
  route('POST', '/api/stock/initial-costs', 'accountant', async req => {
    const b = req.body || {}; must(b, 'reference');
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 200) throw httpErr(400, 'أدخل تكلفة صنف واحد على الأقل');
    if (String(b.reference).trim().length < 2) throw httpErr(400, 'أدخل مرجع مستند التكلفة');
    const ids = new Set();
    for (const item of b.items) { const id = Number(item.product_id), cost = Number(item.unit_cost); if (!Number.isInteger(id) || id < 1 || ids.has(id) || !Number.isFinite(cost) || cost <= 0) throw httpErr(400, 'تحقق من الأصناف والتكاليف المدخلة؛ التكلفة يجب أن تكون أكبر من صفر'); ids.add(id); }
    return tx(req.user.username, async c => {
      let value = 0;
      for (const item of b.items) {
        const { rows: [r] } = await c.query(`SELECT set_stock_initial_cost($1,$2::numeric,$3,$4) event_id, qty FROM product_costing WHERE product_id=$1`, [item.product_id, item.unit_cost, String(b.reference).trim(), req.user.username]);
        if (!r) throw httpErr(404, 'الصنف غير موجود في تقييم المخزون');
        value += Number(r.qty) * Number(item.unit_cost);
      }
      return { valued_count: ids.size, value_added: value };
    });
  });
  route('GET', '/api/stock', 'viewer', async req => (await q(`SELECT p.id, p.sku, p.name_ar, p.category, s.id store_id, s.name_ar store, fn_on_hand(p.id,s.id) on_hand, fn_reserved(p.id,s.id) reserved, fn_available(p.id,s.id) available,
      coalesce(c.avg_cost, p.cost_price) avg_cost, round(greatest(fn_on_hand(p.id,s.id),0) * coalesce(c.avg_cost, p.cost_price), 2) stock_value
    FROM products p CROSS JOIN stores s LEFT JOIN product_costing c ON c.product_id=p.id WHERE p.stock_tracked AND p.is_active AND s.is_active AND ($1::int IS NULL OR s.id=$1) ORDER BY s.id, p.name_ar`, [req.query.store_id || null])).rows);
  // totals for the coloured cards: items, total quantity, total value (selected store or all) + ledger comparison (1140)
  route('GET', '/api/stock/summary', 'viewer', async req => {
    const { rows: [t] } = await q(`SELECT count(*)::int items, coalesce(sum(greatest(on_h,0)),0) total_qty, coalesce(sum(round(greatest(on_h,0) * av, 2)),0) total_value,
        count(*) FILTER (WHERE avail <= 0)::int out_of_stock, count(*) FILTER (WHERE avail > 0 AND avail <= 5)::int low_stock
      FROM (SELECT fn_on_hand(p.id,s.id) on_h, fn_available(p.id,s.id) avail, coalesce(c.avg_cost, p.cost_price) av FROM products p CROSS JOIN stores s LEFT JOIN product_costing c ON c.product_id=p.id
            WHERE p.stock_tracked AND p.is_active AND s.is_active AND ($1::int IS NULL OR s.id=$1)) x`, [req.query.store_id || null]);
    const { rows: [g] } = await q('SELECT fn_stock_value() stock_value, fn_inventory_gl_balance() gl_balance');
    return { ...t, all_stock_value: g.stock_value, gl_balance: g.gl_balance, gap: (Math.round((Number(g.stock_value) - Number(g.gl_balance)) * 100) / 100).toFixed(2) };
  });
  route('GET', '/api/stock/moves', 'viewer', async req => (await q(`SELECT m.id, m.product_id, m.store_id, m.qty, m.kind, m.ref, m.note, m.created_by, m.created_at, coalesce(m.move_date, (m.created_at AT TIME ZONE 'Asia/Riyadh')::date)::text move_date,
      m.unit_cost, round(abs(m.qty) * coalesce(m.unit_cost, 0), 2) amount, e.entry_no, p.name_ar product, p.sku, s.name_ar store
    FROM stock_moves m JOIN products p ON p.id=m.product_id JOIN stores s ON s.id=m.store_id LEFT JOIN journal_entries e ON e.id=m.entry_id
    WHERE ($1::int IS NULL OR m.product_id=$1) AND ($2::int IS NULL OR m.store_id=$2) ORDER BY m.id DESC LIMIT 200`, [req.query.product_id || null, req.query.store_id || null])).rows);
  // goods receipt (purchase): date, unit cost, VAT and how it is paid -> journal entry + new average cost. Without unit_cost it is a quantity-only receipt at the current average (no entry).
  route('POST', '/api/stock/receive', 'accountant', async req => { const b = req.body || {}; must(b, 'product_id', 'store_id', 'qty'); if (!(Number(b.qty) > 0)) throw httpErr(400, 'qty must be positive');
    if (b.date && !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw httpErr(400, 'تاريخ الاستلام غير صالح');
    const hasCost = b.unit_cost !== undefined && b.unit_cost !== null && b.unit_cost !== ''; if (hasCost && !(Number(b.unit_cost) >= 0)) throw httpErr(400, 'تكلفة الوحدة غير صالحة');
    const mode = ['credit', 'cash', 'bank'].includes(b.mode) ? b.mode : 'cash';
    return tx(req.user.username, async c => { const { rows: [r] } = await c.query(`SELECT * FROM receive_stock($1,$2,$3::numeric,$4::numeric,$5::date,$6,$7,$8,$9::int,$10::numeric,$11::date,$12)`,
      [b.product_id, b.store_id, b.qty, hasCost ? b.unit_cost : null, b.date || null, b.ref || null, b.note || null, mode, b.vendor_id || null, b.vat_rate === 15 || b.vat_rate === '15' ? 15 : 0, b.due_date || null, req.user.username]);
      return { id: r.r_move_id, entry_id: r.r_entry_id, amount: r.r_amount, avg_cost: r.r_avg_cost }; }); });
  // one-time: stock that existed before valuation was introduced has no ledger entry -> Dr 1140 / Cr equity (admin / accountant, explicit)
  route('POST', '/api/stock/post-opening', 'accountant', async req => { const b = req.body || {}; must(b, 'equity_account');
    return tx(req.user.username, async c => ({ entry_id: (await c.query('SELECT post_stock_opening_valuation($1::date,$2,$3) id', [b.date || null, b.equity_account, req.user.username])).rows[0].id })); });
  route('POST', '/api/stock/count', 'accountant', async req => { const b = req.body || {}; must(b, 'store_id'); const done = [];
    await tx(req.user.username, async c => { for (const x of b.counts || []) { await c.query('SELECT 1 FROM products WHERE id=$1 FOR UPDATE', [x.product_id]); const { rows: [r] } = await c.query('SELECT fn_on_hand($1,$2) h', [x.product_id, b.store_id]); const diff = Number(x.counted) - Number(r.h);
      if (x.counted === '' || x.counted === null || Number.isNaN(Number(x.counted)) || Number(x.counted) < 0) continue;
      if (diff !== 0) { await c.query(`SELECT stock_move($1,$2,$3,'adjustment','count',$4,$5)`, [x.product_id, b.store_id, diff, b.note || 'جرد', req.user.username]); done.push({ product_id: x.product_id, diff }); } } });
    return { adjusted: done }; });

  // ---- branches & users ----
  route('POST', '/api/branches', 'admin', async req => { const b = req.body || {}; must(b, 'code', 'name_ar', 'name_en'); return tx(req.user.username, async c => (await c.query(
    'INSERT INTO branches(code,name_ar,name_en,city) VALUES ($1,$2,$3,$4) RETURNING *', [b.code, b.name_ar, b.name_en, b.city])).rows[0]); });
  route('PUT', '/api/branches/:id', 'admin', async req => tx(req.user.username, async c => (await c.query('UPDATE branches SET is_active=$2 WHERE id=$1 RETURNING *', [req.params.id, !!req.body?.is_active])).rows[0]));
  route('GET', '/api/users', 'admin', async () => (await q('SELECT id,username,full_name,role,is_active FROM users ORDER BY id')).rows);
  route('POST', '/api/users', 'admin', async req => { const b = req.body || {}; must(b, 'username', 'password', 'role'); assertPasswordPolicy(b.password, b.username);
    return tx(req.user.username, async c => ({ id: (await c.query('SELECT admin_create_user($1,$2,$3,$4,$5) id', [b.username, b.password, b.role, b.full_name, req.user.username])).rows[0].id })); });
  route('PUT', '/api/users/:id', 'admin', async req => tx(req.user.username, async c => { await c.query('SELECT admin_set_user($1,$2,$3,$4)', [req.params.id, req.body?.role, !!req.body?.is_active, req.user.username]); return { ok: true }; }));
  route('POST', '/api/me/password', 'viewer', async req => tx(req.user.username, async c => { assertPasswordPolicy(req.body?.new, req.user.username); await c.query('SELECT change_password($1,$2,$3)', [req.user.username, req.body?.old, req.body?.new]); return { ok: true }; }));

  // ---- PUBLIC storefront (no login). Read-only catalogue + checkout; rate limited; prices computed in PostgreSQL ----
  app.get('/shop/:slug', (req, reply) => reply.sendFile('shop.html'));
  app.get('/t/:tenant/shop/:slug', (req, reply) => reply.sendFile('shop.html'));   // path-based multi-tenancy (no wildcard DNS): shop.js sends X-Tenant
  app.get('/api/public/store/:slug', async (req, reply) => {
    if (limited('g:' + req.ip, 120, 60000)) throw httpErr(429, 'too many requests');
    const { rows: [s] } = await q(`SELECT s.id, s.slug, s.name_ar, s.commerce_type, s.features, w.* FROM stores s JOIN store_site w ON w.store_id=s.id WHERE s.slug=$1 AND s.is_active AND w.is_published`, [req.params.slug]);
    if (!s) throw httpErr(404, 'store not found');
    const products = (await q(`SELECT p.id, p.name_ar, p.kind, p.category, p.unit, p.description_ar, p.image_url, p.sale_price, d.disc unit_discount, t.rate vat_rate,
        round((p.sale_price - d.disc) * (1 + t.rate/100), 2) price_incl_vat,
        CASE WHEN p.kind <> 'goods' OR NOT p.stock_tracked OR p.allow_negative THEN true ELSE d.av > 0 END in_stock, CASE WHEN p.kind <> 'goods' OR NOT p.stock_tracked OR p.allow_negative THEN 99 ELSE least(greatest(d.av,0),99) END max_qty
      FROM products p JOIN tax_codes t ON t.code=p.tax_code, LATERAL (SELECT fn_unit_discount(p.id, $1, current_date) disc, fn_available(p.id, $1) av) d
      WHERE p.is_active AND p.published ORDER BY p.category NULLS LAST, p.name_ar`, [s.id])).rows;
    return { store: { slug: s.slug, name_ar: s.name_ar, commerce_type: s.commerce_type, features: s.features }, site: {
      title_ar: s.title_ar, tagline_ar: s.tagline_ar, about_ar: s.about_ar, return_policy_ar: s.return_policy_ar, theme_color: s.theme_color, phone: s.phone, whatsapp: s.whatsapp, email: s.email,
      payment_methods: s.payment_methods, delivery_fee: s.delivery_fee, free_delivery_over: s.free_delivery_over, min_order: s.min_order }, products };
  });
  app.post('/api/public/orders', async (req, reply) => {
    if (limited('o:' + req.ip, 10, 600000)) throw httpErr(429, 'too many orders, try later');
    const b = req.body || {};
    return idempotent({ q, httpErr, req, reply, scope: 'order', fn: async () => {
      const { rows: [r] } = await q('SELECT * FROM place_online_order($1,$2::jsonb,$3::jsonb,$4,$5)', [b.slug, JSON.stringify(b.customer || {}), JSON.stringify(b.lines || []), b.payment, b.notes]);
      return { number: r.number, total: r.total };
    } });
  });
}
