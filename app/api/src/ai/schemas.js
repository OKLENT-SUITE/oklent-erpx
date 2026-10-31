export const ASK_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['feature', 'question'],
  properties: {
    feature: { type: 'string', enum: ['documents', 'rule', 'invoice', 'report'] },
    question: { type: 'string', minLength: 2, maxLength: 4000 },
    rule_id: { type: 'string', pattern: '^R([1-9]|10)$', maxLength: 3 },
    invoice_number: { type: 'string', minLength: 1, maxLength: 40 },
    report_type: { type: 'string', enum: ['auto', 'monthly', 'trial-balance', 'income-statement', 'invoices', 'inventory', 'fleet', 'balance-sheet', 'vat-return', 'receivables-aging'] },
    from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
  }
};

export function validateAsk(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be an object';
  const allowed = new Set(['feature','question','rule_id','invoice_number','report_type','from','to']);
  if (Object.keys(body).some(k => !allowed.has(k))) return 'unknown request field';
  if (!['documents','rule','invoice','report'].includes(body.feature)) return 'unsupported feature';
  if (typeof body.question !== 'string' || body.question.trim().length < 2 || body.question.length > 4000) return 'question must be between 2 and 4000 characters';
  if (body.feature === 'rule' && !/^R(?:[1-9]|10)$/.test(body.rule_id || '')) return 'a valid rule_id is required';
  if (body.feature === 'invoice' && (typeof body.invoice_number !== 'string' || !body.invoice_number.trim() || body.invoice_number.length > 40)) return 'a valid invoice_number is required';
  if (body.feature === 'report') {
    if (!['auto','monthly','trial-balance','income-statement','invoices','inventory','fleet','balance-sheet','vat-return','receivables-aging'].includes(body.report_type)) return 'a supported report_type is required';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(body.to || '')) return 'valid from and to dates are required';
    for (const value of [body.from, body.to]) {
      const date = new Date(value + 'T00:00:00.000Z');
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== value) return 'valid from and to dates are required';
    }
  }
  return null;
}
