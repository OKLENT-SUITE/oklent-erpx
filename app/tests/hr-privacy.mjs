// SEC-01 regression: HR personal/financial data is released by ROLE ALLOWLIST, never by nulling columns.
// Needs a running API + OWNER_DATABASE_URL (to create one throw-away user per role):  node tests/hr-privacy.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url + '/../../api/package.json');
const pg = require('pg');
const BASE = process.env.BASE || 'http://localhost:3100';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'ChangeMe!2026';
const OWNER = process.env.OWNER_DATABASE_URL; if (!OWNER) { console.log('FAIL  OWNER_DATABASE_URL is required'); process.exit(1); }
let failed = 0; const check = (n, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  → ' + x}`); };
const call = async (m, p, body, tk) => { const r = await fetch(BASE + p, { method: m, headers: { ...(body && { 'content-type': 'application/json' }), ...(tk && { authorization: 'Bearer ' + tk }) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const FORBIDDEN = ['national_id', 'phone', 'email', 'notes', 'attachments', 'basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowances',
  'gosi_deduction', 'other_deductions', 'bank_name', 'iban', 'payment_method', 'cost_center', 'hire_date', 'termination_date'];
const ALLOWED = ['id', 'employee_no', 'name_ar', 'name_en', 'status', 'branch_id', 'branch_name', 'department', 'job_title'];

const tag = Date.now().toString().slice(-7), pw = 'Priv-Test-' + tag + '!';
const c = new pg.Client({ connectionString: OWNER }); await c.connect();
const users = {}; for (const role of ['viewer', 'cashier', 'accountant']) { const u = `t_${role}_${tag}`; await c.query('SELECT create_user($1,$2,$3,$4)', [u, pw, role, 'test ' + role]); users[role] = u; }
const tok = async u => (await call('POST', '/api/auth/login', { username: u, password: pw })).body.token;
const admin = (await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW })).body.token;
const emp = await call('POST', '/api/employees', { name_ar: 'موظف اختبار الخصوصية ' + tag, national_id: '1' + tag + '999', phone: '0500000000', email: `p${tag}@example.test`, notes: 'SECRET-NOTE', basic_salary: 7777, iban: 'SA0380000000608010167519', bank_name: 'BANK-X' }, admin);
check('admin creates the privacy fixture employee', emp.status === 200 && emp.body.id, JSON.stringify(emp.body));
const id = emp.body.id;
await c.query("UPDATE employees SET attachments = '[{\"name\":\"passport.pdf\"}]'::jsonb WHERE id=$1", [id]).catch(async () => { await c.query("UPDATE employees SET attachments = 'passport.pdf' WHERE id=$1", [id]).catch(() => {}); });

for (const role of ['viewer', 'cashier']) {
  const t = await tok(users[role]);
  const list = await call('GET', '/api/employees', null, t), one = await call('GET', '/api/employees/' + id, null, t);
  check(`${role}: list 200`, list.status === 200); check(`${role}: detail 200`, one.status === 200);
  const mine = (list.body || []).find(e => e.id === id) || {};
  for (const [where, o] of [['list', mine], ['detail', one.body]]) {
    const leaked = FORBIDDEN.filter(k => k in o); check(`${role}: ${where} has NO forbidden key (not even null)`, leaked.length === 0, leaked.join(','));
    const extra = Object.keys(o).filter(k => !ALLOWED.includes(k)); check(`${role}: ${where} keys are within the allowlist`, extra.length === 0, extra.join(','));
  }
  const raw = JSON.stringify([list.body, one.body]);
  check(`${role}: no sensitive VALUE anywhere in the JSON`, !/SECRET-NOTE|SA0380000000608010167519|7777|BANK-X|passport|0500000000/.test(raw));
  for (const p of ['/api/payroll/runs', '/api/custodies', '/api/expense-claims', '/api/reports/payroll', '/api/reports/hr/payroll-summary', '/api/reports/custodies', '/api/reports/expenses'])
    check(`${role}: GET ${p} -> 403`, (await call('GET', p, null, t)).status === 403);
}
const ta = await tok(users.accountant), full = await call('GET', '/api/employees/' + id, null, ta);
check('accountant still gets the full record (national_id, salary, iban, notes)', full.body.national_id && String(full.body.basic_salary).startsWith('7777') && full.body.iban && full.body.notes === 'SECRET-NOTE', JSON.stringify(full.body));
check('accountant can still read payroll runs', (await call('GET', '/api/payroll/runs', null, ta)).status === 200);
check('anonymous -> 401', (await call('GET', '/api/employees')).status === 401);
check('invalid employee id -> 400', (await call('GET', '/api/employees/abc', null, ta)).status === 400);
await c.query('DELETE FROM employees WHERE id=$1', [id]).catch(() => {}); await c.end();
console.log(failed ? `\n${failed} FAILED` : '\nALL HR PRIVACY CHECKS PASSED'); process.exit(failed ? 1 : 0);
