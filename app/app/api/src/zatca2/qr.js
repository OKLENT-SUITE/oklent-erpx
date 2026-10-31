// ZATCA TLV QR, all nine tags (phase 2 simplified invoices carry 6-9 as well). https://oklent.net/
import { X509Certificate } from 'node:crypto';
const tlv = (tag, buf) => { const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8'); if (b.length > 0xffff) throw new Error('TLV too long');
  const len = b.length < 128 ? Buffer.from([b.length]) : b.length < 256 ? Buffer.from([0x81, b.length]) : Buffer.from([0x82, b.length >> 8, b.length & 255]); return Buffer.concat([Buffer.from([tag]), len, b]); };
export function qrPhase2({ seller, vatNo, timestamp, total, vat, invoiceHashB64, signatureB64, publicKeyDer, certSignatureDer }) {
  const parts = [seller, vatNo, timestamp, total, vat, invoiceHashB64, Buffer.from(signatureB64, 'base64'), publicKeyDer, certSignatureDer].map((v, i) => (v === undefined || v === null ? null : tlv(i + 1, i < 5 || i === 5 ? v : v)));
  return Buffer.concat(parts.filter(Boolean)).toString('base64');
}
export function readTlv(b64) { const b = Buffer.from(b64, 'base64'); const out = {}; let i = 0; while (i < b.length) { const tag = b[i++]; let len = b[i++]; if (len === 0x81) len = b[i++]; else if (len === 0x82) { len = (b[i] << 8) | b[i + 1]; i += 2; } out[tag] = b.subarray(i, i + len); i += len; } return out; }
// --- DER helpers: the certificate signature (tag 9) is the last BIT STRING of the X.509 structure ---
function derItem(buf, off) { const tag = buf[off]; let len = buf[off + 1], h = 2; if (len & 0x80) { const k = len & 0x7f; len = 0; for (let j = 0; j < k; j++) len = (len << 8) | buf[off + 2 + j]; h = 2 + k; } return { tag, start: off + h, end: off + h + len, next: off + h + len }; }
export function certSignatureDer(certPem) {
  const der = new X509Certificate(certPem).raw; const top = derItem(der, 0); let off = top.start; let last;
  while (off < top.end) { const it = derItem(der, off); last = it; off = it.next; }
  if (!last || last.tag !== 0x03) throw new Error('certificate signature not found'); return der.subarray(last.start + 1, last.end);      // skip the "unused bits" byte
}
export const publicKeyDer = certPem => new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' });
