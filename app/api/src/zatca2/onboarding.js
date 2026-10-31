// ZATCA Fatoora portal client (onboarding + reporting/clearance). DISABLED unless ZATCA_ENABLED=1 AND a base URL for the chosen environment resolves.
// Endpoints follow ZATCA's published Developer Portal API (compliance, production CSID, reporting, clearance). They could NOT be exercised from this
// build (no ZATCA account, no network): tests use an injected fetch. Run docs/ZATCA_PHASE2.md "Acceptance checklist" in the sandbox first.
export const BASES = { sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal', simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation', production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core' };
export function zatcaClient({ env = process.env.ZATCA_ENV || 'sandbox', fetchImpl = globalThis.fetch, enabled = /^(1|true|yes)$/i.test(process.env.ZATCA_ENABLED || ''), baseUrl } = {}) {
  const base = baseUrl || BASES[env]; if (!enabled) return { enabled: false, reason: 'ZATCA_ENABLED is not set: phase 2 network calls are off' };
  if (!base) throw new Error('unknown ZATCA environment: ' + env);
  const auth = (user, secret) => 'Basic ' + Buffer.from(`${user}:${secret}`).toString('base64');
  const call = async (method, p, { body, headers = {}, user, secret }) => {
    const r = await fetchImpl(base + p, { method, headers: { 'content-type': 'application/json', 'accept': 'application/json', 'accept-language': 'en', 'accept-version': 'V2', ...(user ? { authorization: auth(user, secret) } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(Number(process.env.ZATCA_TIMEOUT_MS || 20000)) });
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
    return { status: r.status, ok: r.ok, body: json };
  };
  return {
    enabled: true, env, base,
    complianceCsid: (csrPem, otp) => call('POST', '/compliance', { body: { csr: Buffer.from(csrPem).toString('base64') }, headers: { OTP: String(otp) } }),
    complianceCheck: (inv, { user, secret }) => call('POST', '/compliance/invoices', { body: inv, user, secret }),
    productionCsid: (complianceRequestId, { user, secret }) => call('POST', '/production/csids', { body: { compliance_request_id: String(complianceRequestId) }, user, secret }),
    report: (inv, { user, secret }) => call('POST', '/invoices/reporting/single', { body: inv, headers: { 'Clearance-Status': '0' }, user, secret }),      // simplified (B2C): report within 24 h
    clear: (inv, { user, secret }) => call('POST', '/invoices/clearance/single', { body: inv, headers: { 'Clearance-Status': '1' }, user, secret })         // standard (B2B): clearance BEFORE delivery
  };
}
/** Body ZATCA expects for reporting / clearance / compliance check. */
export const submissionBody = ({ signedXml, invoiceHash, uuid }) => ({ invoiceHash, uuid, invoice: Buffer.from(signedXml, 'utf8').toString('base64') });
