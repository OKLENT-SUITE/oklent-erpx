// Printable invoice (A4, RTL) following the ZATCA e-invoicing PHASE 1 (generation) templates. https://oklent.net/
// Pure function: no database, no network. The route loads the rows and passes them in, so every rule below is unit-tested.
//
// Elements printed (phase 1):
//  - Tax invoice (B2B, kind=standard): title, sequential number, issue date/time, supply date, seller name + address + VAT no.,
//    buyer name + address + VAT no. (when the buyer is VAT-registered), per line: description, qty, unit price, discount, taxable amount,
//    VAT rate, VAT amount, line total; totals: discount, total excl. VAT, VAT, total incl. VAT; QR (optional in phase 1, always printed here).
//  - Simplified tax invoice (B2C, kind=simplified): same elements; buyer optional; QR code is MANDATORY and printed larger.
//  - Credit / debit notes: same elements + reference to the original invoice and the reason.
// Not printed: Arabic amount-in-words (not a ZATCA requirement), XAdES signature / QR tags 6-9 (phase 2, see docs/ZATCA.md).

const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = v => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = v => String(Number(v));
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;

export const KINDS = {
  standard: ['فاتورة ضريبية', 'Tax Invoice'], simplified: ['فاتورة ضريبية مبسطة', 'Simplified Tax Invoice'],
  credit: ['إشعار دائن', 'Credit Note'], debit: ['إشعار مدين', 'Debit Note'],
};

const dateOnly = v => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v ?? '').slice(0, 10));   // pg returns DATE as a local-midnight Date
const riyadh = v => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(v));   // "2026-10-17 14:30:05"

const addr = a => [a?.building_no, a?.street, a?.district, a?.city, a?.postal_code].filter(Boolean).map(esc).join('، ');
const L = (ar, en) => `${ar} <span class="en">${en}</span>`;

export function renderInvoiceHtml({ i, co, lines, buyer, related, qrSvg, logo = '/logo.png' }) {
  const [title, en] = KINDS[i.kind] || KINDS.standard; const simplified = i.kind === 'simplified'; const note = i.kind === 'credit' || i.kind === 'debit';
  const rows = lines.map(l => ({ ...l, gross: r2(Number(l.net) + Number(l.vat)) }));
  const discount = r2(rows.reduce((a, l) => a + Number(l.discount || 0), 0)), before = r2(Number(i.subtotal) + discount);
  const byRate = new Map(); for (const l of rows) { const k = Number(l.vat_rate); const e = byRate.get(k) || { base: 0, vat: 0 }; e.base += Number(l.net); e.vat += Number(l.vat); byRate.set(k, e); }
  const meta = [
    [L('رقم الفاتورة', 'Invoice No.'), `<b class="n">${esc(i.number)}</b>`],
    [L('تاريخ ووقت الإصدار', 'Issue date & time'), `<span class="n">${esc(riyadh(i.issue_at))}</span>`],
    [L('تاريخ التوريد', 'Supply date'), `<span class="n">${esc(dateOnly(i.supply_date))}</span>`],
    ...(i.due_date ? [[L('تاريخ الاستحقاق', 'Due date'), `<span class="n">${esc(dateOnly(i.due_date))}</span>`]] : []),
    [L('العداد التسلسلي', 'ICV'), `<span class="n">${esc(i.icv)}</span>`],
    ...(i.issued_by ? [[L('أصدرها (المستخدم)', 'Issued by'), `<span class="n">${esc(i.issued_by)}</span>`]] : []),
    ...(note && related ? [[L('الفاتورة الأصلية', 'Original invoice'), `<b class="n">${esc(related.number)}</b>`]] : []),
    ...(note ? [[L('سبب الإصدار', 'Reason'), esc(i.reason)]] : []),
  ];
  const buyerName = buyer?.name_ar || (simplified ? 'عميل نقدي' : '—');
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>${esc(i.number)}</title>
<style>
@page{size:A4;margin:15mm 12mm}*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font:10pt Tajawal,Arial,sans-serif;color:#0b1f3a;margin:0;line-height:1.45}.n{direction:ltr;unicode-bidi:plaintext;display:inline-block}.en{color:#64748b;font-size:8pt;font-weight:400;margin-inline-start:4px}
.hd{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:center;border-bottom:3px solid #14b8a6;padding-bottom:10px}
.co{display:flex;gap:10px;align-items:center}.co img{width:50px;height:50px;object-fit:contain}.co b{font-size:12pt}.co div div{color:#64748b;font-size:8.5pt}
.ttl{text-align:center;background:#0b1f3a;color:#fff;border-radius:10px;padding:8px 16px}.ttl h1{margin:0;font-size:15pt;white-space:nowrap}.ttl div{font-size:9pt;opacity:.85;direction:ltr}
.qr{text-align:center;width:${simplified ? '38mm' : '30mm'}}.qr svg{width:100%;height:auto;display:block}.qr small{font-size:7pt;color:#64748b}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid #d7dee8;border-radius:8px;margin:10px 0;overflow:hidden}.meta div{padding:5px 9px;border-bottom:1px solid #eef2f7}.meta span.k{display:block;font-size:8.5pt;color:#475569}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}.box{border:1px solid #d7dee8;border-radius:8px;overflow:hidden}.box h3{margin:0;background:#eef6f5;border-bottom:1px solid #d7dee8;padding:5px 9px;font-size:9.5pt}.box div{padding:6px 9px;font-size:9.5pt}.box p{margin:0 0 2px}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{page-break-inside:avoid}
th{background:#0b1f3a;color:#fff;padding:6px 4px;font-size:8.5pt;text-align:center;line-height:1.25}th .en{color:#cbd5e1;display:block;margin:0;font-size:7pt}td{border-bottom:1px solid #d7dee8;padding:6px 5px;vertical-align:top;font-size:9.5pt}td.c{text-align:center}td.m{text-align:left;direction:ltr}tbody tr:nth-child(even) td{background:#f8fafc}
.tw{display:flex;justify-content:flex-start;margin-top:10px;page-break-inside:avoid}.tot{width:62%;border:1px solid #d7dee8;border-radius:8px;overflow:hidden}.tot div{display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #eef2f7}.tot .g{background:#14b8a6;color:#fff;font-weight:800;font-size:11.5pt;border:0}.tot .s{font-size:8.5pt;color:#475569;background:#f8fafc}
.ft{margin-top:14px;font-size:8pt;color:#475569;border-top:1px solid #d7dee8;padding-top:6px;text-align:center}
</style>
<div class="hd"><div class="co"><img src="${esc(logo)}" alt=""><div><b>${esc(co.name_ar)}</b>${co.name_en ? `<div class="n">${esc(co.name_en)}</div>` : ''}<div>${L('الرقم الضريبي', 'VAT No.')}: <span class="n">${esc(co.vat_number)}</span></div></div></div>
<div class="ttl"><h1>${esc(title)}</h1><div>${esc(en)}</div></div><div class="qr">${qrSvg || ''}<small>${simplified ? 'QR إلزامي' : 'QR'}</small></div></div>
<div class="meta">${meta.map(([k, v]) => `<div><span class="k">${k}</span>${v}</div>`).join('')}</div>
<div class="parties">
<div class="box"><h3>${L('البائع', 'Seller')}</h3><div><p><b>${esc(co.name_ar)}</b></p><p>${addr(co) || '—'}</p><p>${L('الرقم الضريبي', 'VAT No.')}: <span class="n">${esc(co.vat_number)}</span></p>${co.cr_number ? `<p>${L('السجل التجاري', 'CR No.')}: <span class="n">${esc(co.cr_number)}</span></p>` : ''}</div></div>
<div class="box"><h3>${L('المشتري', 'Buyer')}</h3><div><p><b>${esc(buyerName)}</b></p>${buyer ? `<p>${addr(buyer) || '—'}</p>` : ''}${buyer?.vat_number ? `<p>${L('الرقم الضريبي', 'VAT No.')}: <span class="n">${esc(buyer.vat_number)}</span></p>` : (!simplified ? `<p style="color:#64748b">${L('الرقم الضريبي', 'VAT No.')}: غير مسجل / —</p>` : '')}${buyer?.cr_number ? `<p>${L('السجل التجاري', 'CR No.')}: <span class="n">${esc(buyer.cr_number)}</span></p>` : ''}</div></div></div>
<table><thead><tr><th>#</th><th style="width:32%">الوصف<span class="en">Description</span></th><th>الكمية<span class="en">Qty</span></th><th>سعر الوحدة<span class="en">Unit price</span></th><th>الخصم<span class="en">Discount</span></th><th>الصافي<span class="en">Taxable amt</span></th><th>الضريبة %<span class="en">VAT %</span></th><th>مبلغ الضريبة<span class="en">VAT amt</span></th><th>الإجمالي<span class="en">Total</span></th></tr></thead>
<tbody>${rows.map(l => `<tr><td class="c">${esc(l.line_no)}</td><td>${esc(l.description)}${l.period_from && l.period_to ? `<div style="font-size:8pt;color:#475569">${L('فترة الإيجار', 'Rental period')}: <span class="n">${esc(dateOnly(l.period_from))}</span> → <span class="n">${esc(dateOnly(l.period_to))}</span></div>` : ''}</td><td class="c m">${qtyFmt(l.qty)}</td><td class="m">${fmt(l.unit_price)}</td><td class="m">${fmt(l.discount || 0)}</td><td class="m">${fmt(l.net)}</td><td class="c m">${qtyFmt(l.vat_rate)}%</td><td class="m">${fmt(l.vat)}</td><td class="m"><b>${fmt(l.gross)}</b></td></tr>`).join('')}</tbody></table>
<div class="tw"><div class="tot">
<div><span>${L('الإجمالي قبل الخصم', 'Total before discount')}</span><span class="n">${fmt(before)}</span></div>
<div><span>${L('إجمالي الخصم', 'Total discount')}</span><span class="n">${fmt(discount)}</span></div>
<div><span>${L('الإجمالي بدون ضريبة', 'Total excl. VAT')}</span><span class="n">${fmt(i.subtotal)}</span></div>
${byRate.size > 1 ? [...byRate].sort((a, b) => b[0] - a[0]).map(([rate, e]) => `<div class="s"><span>${L('ضريبة', 'VAT')} ${qtyFmt(rate)}% — ${L('الوعاء', 'base')} <span class="n">${fmt(e.base)}</span></span><span class="n">${fmt(e.vat)}</span></div>`).join('') : ''}
<div><span>${L('إجمالي ضريبة القيمة المضافة', 'Total VAT')}</span><span class="n">${fmt(i.vat_amount)}</span></div>
<div class="g"><span>${L('الإجمالي شامل الضريبة', 'Total incl. VAT')}</span><span class="n">${fmt(i.total)} SAR</span></div></div></div>
<div class="ft"><span dir="ltr">© 2026 OKLENT BUSINESS.</span> جميع الحقوق محفوظة · وثيقة مُنشأة بواسطة OKLENT-ERPX وفق المرحلة الأولى (الإصدار) من الفوترة الإلكترونية — غير موقّعة تشفيرياً (المرحلة الثانية غير مفعّلة).</div>
</html>`;
}
