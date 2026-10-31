// ZATCA phase 2: XAdES-BES enveloped signature over a UBL invoice (ECDSA secp256k1 + SHA-256). https://oklent.net/
// STATUS: PREPARED, NOT CERTIFIED. Every step is implemented and verified round-trip locally (tests/zatca2-unit.mjs), but acceptance by ZATCA
// can only be proven with a CSID issued to YOUR taxpayer plus the official SDK validator (docs/ZATCA_PHASE2.md, "Acceptance checklist").
// Known ZATCA quirk reproduced on purpose: the certificate digest and the SignedProperties digest are base64(HEX(sha256)), not base64(sha256). Confirm against SDK samples.
import { createSign, createVerify, createHash, X509Certificate } from 'node:crypto';
import { parseXml, canonicalize, invoiceHash, sha256b64, sha256hex } from './c14n.js';
import { qrPhase2, certSignatureDer, publicKeyDer } from './qr.js';

const DS = 'http://www.w3.org/2000/09/xmldsig#', XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const pemBody = pem => pem.replace(/-----[A-Z ]+-----|\s+/g, '');
const issuerName = c => c.issuer.split('\n').reverse().join(',');          // RFC 2253 order: most specific RDN first
const serialDecimal = c => BigInt('0x' + c.serialNumber).toString();

export const signedPropertiesXml = ({ certPem, signingTime }) => {
  const c = new X509Certificate(certPem); const certDigest = b64(createHash('sha256').update(c.raw).digest('hex'));
  return `<xades:SignedProperties xmlns:xades="${XADES}" xmlns:ds="${DS}" Id="xadesSignedProperties"><xades:SignedSignatureProperties><xades:SigningTime>${esc(signingTime)}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${esc(issuerName(c))}</ds:X509IssuerName><ds:X509SerialNumber>${serialDecimal(c)}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>`;
};
export const signedInfoXml = ({ invoiceDigest, propsDigest }) =>
  `<ds:SignedInfo xmlns:ds="${DS}"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${propsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;

// canonical form of a fragment is computed STANDALONE (it declares every namespace it uses), exactly as the ZATCA SDK does
const canonOf = fragment => canonicalize(parseXml(fragment));
const find = (el, name) => { if (typeof el === 'string') return null; if (el.name === name) return el; for (const c of el.children) { const r = find(c, name); if (r) return r; } return null; };
const textOf = el => (el ? el.children.filter(c => typeof c === 'string').join('') : '');

// NOTE: nothing is inserted together with whitespace: white-space text nodes belong to the canonical form, so removing the signature parts must leave the document byte-identical.
/** The root must declare xmlns:ext BEFORE hashing (a namespace declaration is part of the canonical form of the root). */
export function ensureExtNamespace(xml) {
  return /<Invoice\b[^>]*\sxmlns:ext=/.test(xml) ? xml : xml.replace(/<Invoice\b/, `<Invoice xmlns:ext="${EXT}"`);
}

/**
 * Signs `xml` (output of buildUbl) and embeds UBLExtensions + cac:Signature + QR reference.
 * qrFields: { seller, vatNo, timestamp, total, vat }  (tags 1-5; tags 6-9 are added here)
 * Returns { xml, invoiceHash, signatureValue, qr }
 */
export function signInvoice({ xml, privateKeyPem, certPem, signingTime, qrFields }) {
  const base = ensureExtNamespace(xml);
  const invoiceDigest = invoiceHash(base);
  const props = signedPropertiesXml({ certPem, signingTime });
  const propsDigest = b64(sha256hex(canonOf(props)));                       // ZATCA quirk: base64 of the HEX digest
  const info = signedInfoXml({ invoiceDigest, propsDigest });
  const signatureValue = createSign('SHA256').update(canonOf(info), 'utf8').sign(privateKeyPem, 'base64');
  const qr = qrPhase2({ ...qrFields, invoiceHashB64: invoiceDigest, signatureB64: signatureValue, publicKeyDer: publicKeyDer(certPem), certSignatureDer: certSignatureDer(certPem) });
  const sigBlock = `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent><sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature xmlns:ds="${DS}" Id="signature">${info.replace(` xmlns:ds="${DS}"`, '')}<ds:SignatureValue>${signatureValue}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${pemBody(certPem)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="${XADES}" Target="signature">${props.replace(` xmlns:xades="${XADES}"`, '').replace(` xmlns:ds="${DS}"`, '')}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;
  const qrRef = `<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`;
  const sigEl = '<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID><cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature>';
  let out = base.replace(/(<Invoice\b[^>]*>)/, `$1${sigBlock}`);
  out = out.replace('<cac:AccountingSupplierParty>', `${qrRef}${sigEl}<cac:AccountingSupplierParty>`);
  return { xml: out, invoiceHash: invoiceDigest, signatureValue, qr };
}

/** Independent verification of a signed invoice (what a recipient / the SDK does). Returns { ok, errors[] }. */
export function verifySignedInvoice(signedXml) {
  const errors = [];
  try {
    const root = parseXml(signedXml); const sigEl = find(root, 'ds:Signature'); if (!sigEl) return { ok: false, errors: ['no ds:Signature'] };
    const info = find(sigEl, 'ds:SignedInfo'), props = find(sigEl, 'xades:SignedProperties');
    const refs = info.children.filter(c => typeof c !== 'string' && c.name === 'ds:Reference');
    const dig = r => textOf(find(r, 'ds:DigestValue')).trim();
    if (dig(refs[0]) !== invoiceHash(signedXml)) errors.push('invoice digest does not match the invoice content');
    if (dig(refs[1]) !== b64(sha256hex(canonicalize(props, new Map([['ds', DS], ['xades', XADES]]))))) errors.push('SignedProperties digest mismatch');
    const certPem = `-----BEGIN CERTIFICATE-----\n${textOf(find(sigEl, 'ds:X509Certificate')).trim()}\n-----END CERTIFICATE-----`;
    const cert = new X509Certificate(certPem);
    const declared = textOf(find(props, 'ds:DigestValue')).trim();
    if (declared !== b64(createHash('sha256').update(cert.raw).digest('hex'))) errors.push('certificate digest in SignedProperties does not match the embedded certificate');
    const okSig = createVerify('SHA256').update(canonicalize(info, new Map([['ds', DS]])), 'utf8').verify(cert.publicKey, textOf(find(sigEl, 'ds:SignatureValue')).trim(), 'base64');
    if (!okSig) errors.push('ECDSA signature invalid');
  } catch (e) { errors.push('verification error: ' + e.message); }
  return { ok: errors.length === 0, errors };
}
