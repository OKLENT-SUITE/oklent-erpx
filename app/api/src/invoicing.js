import { randomUUID } from 'node:crypto';
import { tx } from './db.js';
import { buildUbl, xmlHash, qrTlv } from './zatca.js';
import { riyadhToday } from './dates.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = v => DATE_RE.test(v || '') && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const riyadhClock = (now = Date.now()) => new Date(now + 3 * 3600e3).toISOString().slice(11, 19);   // HH:MM:SS in Asia/Riyadh (UTC+3, no DST)
/** The business date chosen by the user (default: today in Riyadh). Never in the future; the open-period rule is enforced by the database. */
export function resolveInvoiceDate(v, now = Date.now()) {
  const today = riyadhToday(now);
  if (v === undefined || v === null || v === '') return { date: today, issueAt: new Date(now).toISOString() };
  if (!validDate(v)) throw httpErr(400, 'تاريخ الفاتورة غير صالح (YYYY-MM-DD)');
  if (v > today) throw httpErr(422, 'ERPX-E020: تاريخ الفاتورة لا يمكن أن يكون في المستقبل');
  if (v < '2000-01-01') throw httpErr(400, 'تاريخ الفاتورة غير منطقي');
  // the chosen day + the current Riyadh clock time (a tax invoice always carries a time); today keeps the exact instant
  return { date: v, issueAt: v === today ? new Date(now).toISOString() : new Date(`${v}T${riyadhClock(now)}+03:00`).toISOString() };
}

/** Issue an invoice / credit note / debit note. Everything happens in ONE transaction:
 *  lock chain -> number -> XML -> hash -> QR -> record_invoice() (entry + invoice + lines). The DB re-verifies ICV/PIH/totals. */
export async function issueInvoice(user, b, after) {
  if (!['standard', 'simplified', 'credit', 'debit'].includes(b.kind)) throw httpErr(400, 'kind must be standard|simplified|credit|debit');
  return tx(user, async c => {
    const { rows: [chain] } = await c.query('SELECT * FROM lock_invoice_chain()');
    const { rows: [company] } = await c.query('SELECT * FROM company');
    const partner = b.partner_id ? (await c.query('SELECT * FROM partners WHERE id=$1', [b.partner_id])).rows[0] : null;
    let related = null, srcLines = b.lines;
    if (b.kind === 'credit' || b.kind === 'debit') {
      related = (await c.query('SELECT * FROM invoices WHERE id=$1', [b.related_invoice_id])).rows[0];
      if (!related) throw httpErr(400, 'related_invoice_id not found');
      if (!srcLines?.length) srcLines = (await c.query(`SELECT description, qty, unit_price, discount, tax_code, (SELECT code FROM accounts WHERE id=revenue_account_id) revenue_account FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_no`, [related.id])).rows;
    }
    if (!srcLines?.length) throw httpErr(400, 'at least one line is required');
    if (srcLines.length > 100) throw httpErr(400, 'حتى 100 بند في الفاتورة الواحدة');
    const when = resolveInvoiceDate(b.invoice_date);
    const lines = [];
    for (const l0 of srcLines) {
      const l = { ...l0 };
      if (l.product_id) {                                  // product line: defaults come from the product; price may be overridden by the user
        const { rows: [p] } = await c.query(`SELECT p.id, p.kind, p.name_ar, p.tax_code, p.sale_price, p.stock_tracked, p.is_active, a.code rev FROM products p JOIN accounts a ON a.id=p.revenue_account_id WHERE p.id=$1`, [l.product_id]);
        if (!p || !p.is_active) throw httpErr(400, `المنتج ${l.product_id} غير موجود أو غير نشط`);
        l.description = (l.description || '').trim() || p.name_ar; l.tax_code = l.tax_code || p.tax_code; l.revenue_account = l.revenue_account || p.rev;
        if (l.unit_price === undefined || l.unit_price === '' || l.unit_price === null) l.unit_price = p.sale_price;
        l.product_id = p.id; l._stock = p.stock_tracked && p.kind === 'goods'; l._kind = p.kind;
      } else { delete l.product_id; }
      if (!(Number(l.qty) > 0)) throw httpErr(400, 'الكمية يجب أن تكون أكبر من صفر');
      if (!(Number(l.unit_price) >= 0)) throw httpErr(400, 'سعر الوحدة غير صالح');
      if (!l.description || !String(l.description).trim()) throw httpErr(400, 'وصف البند مطلوب');
      const rental = l._kind === 'rental' || String(l.revenue_account) === '4100';
      const hasPeriod = l.period_from || l.period_to;
      if ((rental && b.enforce_rental_period && b.kind !== 'credit' && b.kind !== 'debit') || hasPeriod) {   // manual rental line: the rental period is mandatory
        if (!validDate(l.period_from) || !validDate(l.period_to)) throw httpErr(422, 'ERPX-E021: حدّد فترة الإيجار (من تاريخ / إلى تاريخ) لبند الإيجار');
        if (l.period_to < l.period_from) throw httpErr(422, 'ERPX-E021: تاريخ نهاية الإيجار قبل تاريخ البداية');
      } else { l.period_from = l.period_to = null; }
      // exact decimal maths in the DB (never JS floats)
      const { rows: [r] } = await c.query(
        `SELECT round($1::numeric*$2::numeric-coalesce($3::numeric,0),2) net, t.rate, t.category cat,
                round(round($1::numeric*$2::numeric-coalesce($3::numeric,0),2)*t.rate/100,2) vat FROM tax_codes t WHERE t.code=$4`,
        [l.qty, l.unit_price, l.discount ?? 0, l.tax_code]);
      if (!r) throw httpErr(400, `unknown tax_code ${l.tax_code}`);
      lines.push({ ...l, discount: l.discount ?? 0, net: r.net, vat: r.vat, rate: r.rate, cat: r.cat });
    }
    const { rows: [t] } = await c.query(
      `SELECT sum(net)::numeric(20,2)::text s, sum(vat)::numeric(20,2)::text v FROM jsonb_to_recordset($1::jsonb) x(net numeric, vat numeric)`, [JSON.stringify(lines)]);
    const total = (await c.query('SELECT ($1::numeric+$2::numeric)::text t', [t.s, t.v])).rows[0].t;
    const number = (await c.query('SELECT next_invoice_no($1) n', [b.kind])).rows[0].n;
    const issueAt = when.issueAt;
    const inv = { kind: b.kind, baseKind: related?.kind === 'simplified' ? 'simplified' : 'standard', number, uuid: randomUUID(), icv: Number(chain.last_icv) + 1, pih: chain.last_hash,
                  subtotal: t.s, vat_amount: t.v, total, reason: b.reason, related_number: related?.number };
    const xml = buildUbl({ company, inv, partner, lines, issueAt });
    const hash = xmlHash(xml);
    const qr = qrTlv({ seller: company.name_ar, vatNo: company.vat_number, timestamp: issueAt.slice(0, 19) + 'Z', total, vat: t.v });
    const { rows: [{ id }] } = await c.query('SELECT record_invoice($1::jsonb,$2::jsonb) id', [JSON.stringify({
      number, kind: b.kind, issue_at: issueAt, supply_date: (validDate(b.supply_date) ? b.supply_date : when.date), due_date: b.due_date, partner_id: b.partner_id,
      related_invoice_id: b.related_invoice_id, reason: b.reason, branch: b.branch, lease_id: b.lease_id, rent_schedule_id: b.rent_schedule_id,
      uuid: inv.uuid, icv: inv.icv, pih: inv.pih, invoice_hash: hash, qr, xml, issued_by: user }), JSON.stringify(lines)]);
    const stockLines = lines.filter(l => l._stock);
    let cogs = 0;
    if (stockLines.length) {                               // invoice approval -> stock cycle: stock out + Dr 5100 / Cr 1140 at the moving-average cost (one entry per invoice)
      let sid = Number(b.store_id) || null;
      if (!sid) sid = (await c.query(`SELECT s.id FROM stores s LEFT JOIN branches br ON br.id=s.branch_id WHERE s.is_active ORDER BY (br.code IS NOT DISTINCT FROM $1) DESC, s.id LIMIT 1`, [b.branch ?? null])).rows[0]?.id;
      if (!sid) throw httpErr(409, 'لا يوجد مخزن/متجر نشط لخصم المخزون');
      cogs = Number((await c.query('SELECT post_invoice_stock($1,$2,$3) v', [id, sid, user])).rows[0].v);
    }
    if (after) await after(c, id, { number, total });   // runs in the SAME transaction (e.g. POS payment, order link)
    return { id, number, total, icv: inv.icv, invoice_hash: hash, invoice_date: when.date, cogs };
  });
}

export function httpErr(status, message) { const e = new Error(message); e.statusCode = status; return e; }
