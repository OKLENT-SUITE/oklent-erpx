import { createHash } from 'node:crypto';

const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/** ZATCA TLV QR (Phase 1 tags 1-5): seller, VAT no, ISO timestamp, total with VAT, VAT amount. */
export function qrTlv({ seller, vatNo, timestamp, total, vat }) {
  const parts = [seller, vatNo, timestamp, total, vat].map((v, i) => {
    const b = Buffer.from(String(v), 'utf8');
    if (b.length > 255) throw new Error('TLV value too long');
    return Buffer.concat([Buffer.from([i + 1, b.length]), b]);
  });
  return Buffer.concat(parts).toString('base64');
}

/** Hash of the document XML, base64 of SHA-256. NOTE: ZATCA Phase 2 requires canonicalised (C14N 1.1) XML + XAdES signature; see docs/ZATCA.md. */
export const xmlHash = xml => createHash('sha256').update(xml, 'utf8').digest('base64');

const TYPE = { standard: ['388', '0100000'], simplified: ['388', '0200000'], credit: ['381', null], debit: ['383', null] };

/** UBL 2.1 skeleton using ZATCA field names. Not signed. */
export function buildUbl({ company, inv, partner, lines, issueAt }) {
  const d = new Date(issueAt);
  const ksa = new Date(d.getTime() + 3 * 3600e3).toISOString();   // Riyadh = UTC+3 (no DST)
  const [code, sub] = TYPE[inv.kind];
  const subtype = sub || (inv.baseKind === 'simplified' ? '0200000' : '0100000');
  const party = (tag, p) => `<cac:${tag}><cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="${p.vat_number ? 'VAT' : 'CRN'}">${esc(p.vat_number || p.cr_number || '')}</cbc:ID></cac:PartyIdentification>
      <cac:PostalAddress><cbc:StreetName>${esc(p.street)}</cbc:StreetName><cbc:BuildingNumber>${esc(p.building_no)}</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>${esc(p.district)}</cbc:CitySubdivisionName><cbc:CityName>${esc(p.city)}</cbc:CityName>
        <cbc:PostalZone>${esc(p.postal_code)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>${esc(p.vat_number || '')}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name_ar)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party></cac:${tag}>`;
  const catOf = l => (l.rate > 0 ? 'S' : l.cat);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(inv.number)}</cbc:ID>
  <cbc:UUID>${inv.uuid}</cbc:UUID>
  <cbc:IssueDate>${ksa.slice(0, 10)}</cbc:IssueDate>
  <cbc:IssueTime>${ksa.slice(11, 19)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${subtype}">${code}</cbc:InvoiceTypeCode>
  ${inv.reason ? `<cbc:Note>${esc(inv.reason)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode><cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  ${inv.related_number ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(inv.related_number)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
  <cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${inv.icv}</cbc:UUID></cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${inv.pih}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  ${party('AccountingSupplierParty', company)}
  ${party('AccountingCustomerParty', partner || { name_ar: 'عميل نقدي' })}
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${inv.vat_amount}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="SAR">${inv.subtotal}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="SAR">${inv.subtotal}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="SAR">${inv.total}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${inv.total}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${lines.map((l, i) => `  <cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${l.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="SAR">${l.net}</cbc:LineExtensionAmount>
    ${l.period_from && l.period_to ? `<cac:InvoicePeriod><cbc:StartDate>${esc(l.period_from)}</cbc:StartDate><cbc:EndDate>${esc(l.period_to)}</cbc:EndDate></cac:InvoicePeriod>` : ''}
    <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${l.vat}</cbc:TaxAmount></cac:TaxTotal>
    <cac:Item><cbc:Name>${esc(l.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${catOf(l)}</cbc:ID><cbc:Percent>${l.rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="SAR">${l.unit_price}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`).join('\n')}
</Invoice>`;
}
