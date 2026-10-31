// CSR generation for the ZATCA onboarding (compliance CSID request). Uses the openssl CLI (present in the Docker image: apk add openssl).
// ZATCA CSR rules: EC secp256k1 key, SHA-256, subject C/OU/O/CN, extension certificateTemplateName, SAN dirName with SN / UID(VAT) / title(1100 = B2B+B2C) / registeredAddress / businessCategory.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const run = promisify(execFile);
const TEMPLATE = { sandbox: 'TSTZATCA-Code-Signing', simulation: 'PREZATCA-Code-Signing', production: 'ZATCA-Code-Signing' };

export function csrConfig({ env = 'sandbox', commonName, organization, organizationUnit, country = 'SA', vatNumber, solutionName = 'OKLENT', model = 'ERPX', serial, invoiceTypes = '1100', address, businessCategory }) {
  if (!/^3[0-9]{13}3$/.test(vatNumber || '')) throw new Error('VAT number must be 15 digits starting and ending with 3');
  if (!/^[01]{4}$/.test(invoiceTypes)) throw new Error('invoiceTypes must be 4 digits of 0/1 (TSCZ), e.g. 1100');
  const sn = serial || `1-${solutionName}|2-${model}|3-${vatNumber.slice(-6)}-${Date.now().toString(36)}`;
  const clean = s => String(s || '').replace(/[\r\n=,\\"]/g, ' ').trim();
  return `[req]\nprompt = no\nutf8 = no\ndistinguished_name = dn\nreq_extensions = v3\n[dn]\nC = ${clean(country)}\nOU = ${clean(organizationUnit || organization)}\nO = ${clean(organization)}\nCN = ${clean(commonName)}\n[v3]\n1.3.6.1.4.1.311.20.2 = ASN1:UTF8String:${TEMPLATE[env] || TEMPLATE.sandbox}\nsubjectAltName = dirName:alt\n[alt]\nSN = ${clean(sn)}\nUID = ${vatNumber}\ntitle = ${invoiceTypes}\nregisteredAddress = ${clean(address || 'Riyadh')}\nbusinessCategory = ${clean(businessCategory || 'Supply activities')}\n`;
}
/** Returns { privateKeyPem, csrPem }. The private key never leaves this process unencrypted: store it with sealSecret() (totp.js) or in a KMS. */
export async function generateCsr(params) {
  const dir = await mkdtemp(path.join(tmpdir(), 'zatca-csr-'));
  try {
    const key = path.join(dir, 'k.pem'), cfg = path.join(dir, 'c.cnf'), out = path.join(dir, 'r.csr');
    await writeFile(cfg, csrConfig(params), { mode: 0o600 });
    await run('openssl', ['ecparam', '-name', 'secp256k1', '-genkey', '-noout', '-out', key]);
    await run('openssl', ['req', '-new', '-sha256', '-key', key, '-config', cfg, '-out', out]);
    return { privateKeyPem: await readFile(key, 'utf8'), csrPem: await readFile(out, 'utf8') };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
