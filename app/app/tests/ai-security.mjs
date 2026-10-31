import assert from 'node:assert/strict';
import { aiConfig, allowedFeature, publicAIStatus } from '../api/src/ai/policies.js';
import { validateAsk } from '../api/src/ai/schemas.js';

const off = aiConfig({ AI_LOCAL_ENABLED:'false' });
assert.equal(off.ready, false);
assert.equal(publicAIStatus(off).model, null);
const ready = aiConfig({ AI_ENABLED:'true', AI_BASE_URL:'https://provider.example/v1', AI_MODEL:'m', AI_API_KEY:'server-secret' });
assert.equal(ready.ready, true);
assert.equal(ready.provider, 'local');
assert.equal(ready.apiKey, undefined);
assert.equal(publicAIStatus(ready).external_required, false);
assert.equal(allowedFeature('viewer','invoice'), true);
assert.equal(allowedFeature('guest','invoice'), false);
assert.equal(allowedFeature('admin','arbitrary-sql'), false);
assert.equal(validateAsk({ feature:'documents', question:'ما الإجراء؟' }), null);
assert.notEqual(validateAsk({ feature:'documents', question:'سؤال', sql:'DROP TABLE users' }), null);
assert.notEqual(validateAsk({ feature:'report', question:'تلخيص', report_type:'monthly', from:'2026-02-30', to:'2026-03-01' }), null);
for (const report_type of ['auto','invoices','inventory','fleet','balance-sheet','vat-return','receivables-aging'])
  assert.equal(validateAsk({feature:'report',question:'ملخص',report_type,from:'2026-01-01',to:'2026-01-31'}),null);
assert.notEqual(validateAsk({feature:'report',question:'SQL',report_type:'arbitrary-sql',from:'2026-01-01',to:'2026-01-31'}),null);

console.log('Local AI policy/schema checks passed');
