import { randomUUID } from 'node:crypto';
import { tx } from './db.js';
import { buildUbl, xmlHash, qrTlv } from './zatca.js';

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
    const lines = [];
    for (const l of srcLines) {        // exact decimal maths in the DB (never JS floats)
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
    const issueAt = new Date().toISOString();
    const inv = { kind: b.kind, baseKind: related?.kind === 'simplified' ? 'simplified' : 'standard', number, uuid: randomUUID(), icv: Number(chain.last_icv) + 1, pih: chain.last_hash,
                  subtotal: t.s, vat_amount: t.v, total, reason: b.reason, related_number: related?.number };
    const xml = buildUbl({ company, inv, partner, lines, issueAt });
    const hash = xmlHash(xml);
    const qr = qrTlv({ seller: company.name_ar, vatNo: company.vat_number, timestamp: issueAt.slice(0, 19) + 'Z', total, vat: t.v });
    const { rows: [{ id }] } = await c.query('SELECT record_invoice($1::jsonb,$2::jsonb) id', [JSON.stringify({
      number, kind: b.kind, issue_at: issueAt, supply_date: b.supply_date || issueAt.slice(0, 10), due_date: b.due_date, partner_id: b.partner_id,
      related_invoice_id: b.related_invoice_id, reason: b.reason, branch: b.branch, lease_id: b.lease_id, rent_schedule_id: b.rent_schedule_id,
      uuid: inv.uuid, icv: inv.icv, pih: inv.pih, invoice_hash: hash, qr, xml, issued_by: user }), JSON.stringify(lines)]);
    if (after) await after(c, id, { number, total });   // runs in the SAME transaction (e.g. POS payment, order link)
    return { id, number, total, icv: inv.icv, invoice_hash: hash };
  });
}

export function httpErr(status, message) { const e = new Error(message); e.statusCode = status; return e; }
