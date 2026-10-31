// ZATCA phase 2 PREPARATION tests (no database, no network): C14N, hash, XAdES signature round-trip, 9-tag QR, CSR, onboarding client with a mock gateway.
// This proves our own implementation is self-consistent. It does NOT prove ZATCA acceptance: see docs/ZATCA_PHASE2.md.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = f => import(pathToFileURL(path.join(root, 'api/src', f)).href);
const C = await imp('zatca2/c14n.js'), SG = await imp('zatca2/sign.js'), QR = await imp('zatca2/qr.js'), CSR = await imp('zatca2/csr.js'), ON = await imp('zatca2/onboarding.js'), Z = await imp('zatca.js');
let failed = 0; const chk = (n, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : '  → ' + x}`); };

// ---- C14N ----
const cn = s => C.canonicalize(C.parseXml(s));
chk('c14n: empty element expanded, attribute whitespace normalised', cn('<doc>\n<e1   />\n<e2 ></e2></doc>') === '<doc>\n<e1></e1>\n<e2></e2></doc>');
chk('c14n: attributes sorted, quotes normalised', cn("<a z='1' b=\"2\" a=\"3\"/>") === '<a a="3" b="2" z="1"></a>');
chk('c14n: namespace declarations first, sorted by prefix, redundant ones dropped', cn('<a xmlns:z="u:z" xmlns:b="u:b"><c xmlns:b="u:b"/></a>') === '<a xmlns:b="u:b" xmlns:z="u:z"><c></c></a>');
chk('c14n: text and attribute escaping', cn('<a t="x&quot;&lt;&#10;">1 &amp; 2 &gt; 0 &#13;</a>') === '<a t="x&quot;&lt;&#xA;">1 &amp; 2 &gt; 0 &#xD;</a>');
chk('c14n: CDATA becomes escaped text; XML declaration and comments dropped', cn('<?xml version="1.0"?><a><!-- c --><![CDATA[<x>&]]></a>') === '<a>&lt;x&gt;&amp;</a>');
chk('c14n: DOCTYPE refused (no entity expansion attacks)', (() => { try { C.parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>'); return false; } catch { return true; } })());
chk('c14n: malformed XML refused', ['<a><b></a>', '<a>', 'text', '<a b=1/>'].every(s => { try { C.parseXml(s); return false; } catch { return true; } }));

// ---- invoice + keys ----
const company = { vat_number: '300000000000003', cr_number: '1010000000', name_ar: 'شركة تجريبية', street: 'طريق الملك فهد', building_no: '1234', district: 'العليا', city: 'الرياض', postal_code: '12214' };
const inv = { kind: 'simplified', baseKind: 'simplified', number: 'INV-1001', uuid: '8e6000cf-1a98-4174-b3e7-b5d5954bc10d', icv: 7, pih: 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==', subtotal: '100.00', vat_amount: '15.00', total: '115.00' };
const xml = Z.buildUbl({ company, inv, partner: null, lines: [{ qty: 1, net: '100.00', vat: '15.00', description: 'خدمة & صيانة', rate: 15, unit_price: '100.00', cat: 'S' }], issueAt: '2026-10-26T09:30:00Z' });
const h1 = C.invoiceHash(xml);
chk('hash: base64 SHA-256 (44 chars) and deterministic', /^[A-Za-z0-9+/]{43}=$/.test(h1) && h1 === C.invoiceHash(xml));
chk('hash: insensitive to attribute order / empty-element style / XML declaration', C.invoiceHash(xml.replace('<?xml version="1.0" encoding="UTF-8"?>\n', '').replace(/<cbc:IssueDate>/, '<cbc:IssueDate >')) === h1);
chk('hash: changes when ANY amount changes', C.invoiceHash(xml.replace('115.00', '116.00')) !== h1 && C.invoiceHash(xml.replace('خدمة', 'خدمه')) !== h1);
chk('hash: the plain Phase-1 xmlHash is NOT the phase-2 hash (that was defect #2)', Z.xmlHash(xml) !== h1);

// ---- signing round trip (needs the openssl CLI to make a throw-away secp256k1 certificate) ----
let haveSsl = true; try { execFileSync('openssl', ['version']); } catch { haveSsl = false; }
if (!haveSsl) console.log('SKIP signing/CSR checks: openssl CLI not found');
else {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'z2-'));
  execFileSync('openssl', ['ecparam', '-name', 'secp256k1', '-genkey', '-noout', '-out', d + '/k.pem']);
  execFileSync('openssl', ['req', '-new', '-x509', '-key', d + '/k.pem', '-subj', '/C=SA/O=Test/CN=TST-886431145-300000000000003', '-days', '30', '-out', d + '/c.pem', '-sha256']);
  const key = fs.readFileSync(d + '/k.pem', 'utf8'), cert = fs.readFileSync(d + '/c.pem', 'utf8');
  const qrFields = { seller: company.name_ar, vatNo: company.vat_number, timestamp: '2026-10-26T12:30:00', total: '115.00', vat: '15.00' };
  const s = SG.signInvoice({ xml, privateKeyPem: key, certPem: cert, signingTime: '2026-10-26T12:30:00', qrFields });
  chk('sign: output is well-formed XML', (() => { try { C.parseXml(s.xml); return true; } catch (e) { return e.message; } })() === true);
  chk('sign: UBLExtensions, cac:Signature and the QR reference are embedded', /<ext:UBLExtensions>/.test(s.xml) && /<cac:Signature>/.test(s.xml) && /<cbc:ID>QR<\/cbc:ID>/.test(s.xml));
  chk('sign: embedding the signature parts does not change the invoice hash', C.invoiceHash(s.xml) === s.invoiceHash);
  const v = SG.verifySignedInvoice(s.xml); chk('verify: a freshly signed invoice verifies', v.ok, v.errors.join('; '));
  chk('verify: tampering with an amount is detected', !SG.verifySignedInvoice(s.xml.replace('<cbc:PayableAmount currencyID="SAR">115.00', '<cbc:PayableAmount currencyID="SAR">1.00')).ok);
  chk('verify: tampering with the signature value is detected', !SG.verifySignedInvoice(s.xml.replace(/(<ds:SignatureValue>)(.)/, (m, a, c) => a + (c === 'A' ? 'B' : 'A'))).ok);
  chk('verify: swapping the certificate for another key is detected', (() => { execFileSync('openssl', ['ecparam', '-name', 'secp256k1', '-genkey', '-noout', '-out', d + '/k2.pem']); execFileSync('openssl', ['req', '-new', '-x509', '-key', d + '/k2.pem', '-subj', '/CN=evil', '-days', '5', '-out', d + '/c2.pem']);
    const other = fs.readFileSync(d + '/c2.pem', 'utf8').replace(/-----[A-Z ]+-----|\s+/g, ''); return !SG.verifySignedInvoice(s.xml.replace(/(<ds:X509Certificate>)[^<]+/, '$1' + other)).ok; })());
  const t = QR.readTlv(s.qr);
  chk('qr: nine TLV tags, text tags match the invoice', Object.keys(t).length === 9 && t[1].toString() === company.name_ar && t[2].toString() === company.vat_number && t[4].toString() === '115.00' && t[5].toString() === '15.00');
  chk('qr: tag 6 = invoice hash, tag 7 = the signature, tags 8/9 present', t[6].toString() === s.invoiceHash && t[7].equals(Buffer.from(s.signatureValue, 'base64')) && t[8].length > 40 && t[9].length > 60);
  chk('qr: embedded in the XML equals the returned QR', s.xml.includes(s.qr));
  // CSR
  const csr = await CSR.generateCsr({ env: 'sandbox', commonName: 'TST-886431145-300000000000003', organization: 'Test Co', vatNumber: '300000000000003' });
  fs.writeFileSync(d + '/r.csr', csr.csrPem);
  const txt = execFileSync('openssl', ['req', '-in', d + '/r.csr', '-noout', '-text', '-verify'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  chk('csr: verifies, secp256k1, SHA-256, template name and VAT in the SAN', /secp256k1/.test(txt) && /ecdsa-with-SHA256/.test(txt) && /TSTZATCA-Code-Signing/.test(txt) && /300000000000003/.test(txt));
  fs.rmSync(d, { recursive: true, force: true });
}
chk('csr: bad VAT / bad invoice-type flags refused', (() => { try { CSR.csrConfig({ commonName: 'x', organization: 'x', vatNumber: '123' }); return false; } catch { return true; } })() && (() => { try { CSR.csrConfig({ commonName: 'x', organization: 'x', vatNumber: '300000000000003', invoiceTypes: '12' }); return false; } catch { return true; } })());
chk('csr: config injection characters are neutralised (no new section / key can be started)', (() => { const c = CSR.csrConfig({ commonName: 'a\n[evil]\nx=y', organization: 'o', vatNumber: '300000000000003' }); return !/\n\[evil\]/.test(c) && !/\nx=y/.test(c); })());

// ---- onboarding client (mock gateway) ----
chk('onboarding: disabled by default (no network call possible)', ON.zatcaClient({ enabled: false }).enabled === false);
const calls = []; const mock = async (url, o) => { calls.push({ url, o }); return { status: 200, ok: true, text: async () => '{"requestID":"1234","dispositionMessage":"ISSUED"}' }; };
const cl = ON.zatcaClient({ env: 'sandbox', enabled: true, fetchImpl: mock });
await cl.complianceCsid('-----BEGIN CERTIFICATE REQUEST-----\nAAA\n-----END CERTIFICATE REQUEST-----', '123345');
await cl.report(ON.submissionBody({ signedXml: '<Invoice/>', invoiceHash: 'h', uuid: 'u' }), { user: 'cert', secret: 'sec' });
await cl.clear({ invoiceHash: 'h' }, { user: 'cert', secret: 'sec' });
chk('onboarding: compliance CSID sends the base64 CSR + OTP header, no credentials', calls[0].url.endsWith('/developer-portal/compliance') && calls[0].o.headers.OTP === '123345' && !calls[0].o.headers.authorization && JSON.parse(calls[0].o.body).csr.length > 20);
chk('onboarding: reporting uses Basic auth and Clearance-Status 0; clearance uses 1', calls[1].url.endsWith('/invoices/reporting/single') && calls[1].o.headers['Clearance-Status'] === '0' && calls[1].o.headers.authorization === 'Basic ' + Buffer.from('cert:sec').toString('base64') && calls[2].url.endsWith('/invoices/clearance/single') && calls[2].o.headers['Clearance-Status'] === '1');
chk('onboarding: submission body carries base64 invoice + hash + uuid', JSON.parse(calls[1].o.body).invoice === Buffer.from('<Invoice/>').toString('base64'));
chk('onboarding: unknown environment refused', (() => { try { ON.zatcaClient({ env: 'moon', enabled: true, fetchImpl: mock }); return false; } catch { return true; } })());

console.log(failed ? `\n${failed} FAILED` : '\nALL ZATCA-2 PREPARATION CHECKS PASSED'); process.exit(failed ? 1 : 0);
