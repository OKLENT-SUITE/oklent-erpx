// API-01 / T-13: input validation on the employee endpoints. Every bad input must answer 400 with a SAFE message (no SQL / table / constraint text).  node tests/hr-validation.mjs
const API = process.env.API_URL || 'http://localhost:3100'; let tk, failed = 0;
const call = async (m, p, b) => { const r = await fetch(API + p, { method: m, headers: { ...(b !== undefined && { 'content-type': 'application/json' }), authorization: 'Bearer ' + tk }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, text: await r.text() }; };
const ck = (n, ok, x = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  → ' + x}`); };
tk = (await (await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD || 'ChangeMe!2026' }) })).json()).token;
const T = Date.now(), base = { name_ar: 'تحقق ' + T };
const LEAK = /employees_|violates|relation "|column "|constraint|SELECT |INSERT |pg_|syntax error/i;
const cases = [
  ['salary NaN text', { ...base, basic_salary: 'abc' }], ['salary negative', { ...base, basic_salary: -5 }], ['salary 3 decimals', { ...base, basic_salary: '10.123' }], ['salary huge', { ...base, basic_salary: 1e15 }],
  ['salary Infinity-like', { ...base, basic_salary: '1e999' }], ['salary object', { ...base, basic_salary: {} }], ['bad hire date', { ...base, hire_date: '2026-13-45' }], ['hire date text', { ...base, hire_date: 'yesterday' }],
  ['termination before hire', { ...base, hire_date: '2026-05-01', termination_date: '2026-01-01' }], ['bad status', { ...base, status: 'fired' }], ['bad payment method', { ...base, payment_method: 'crypto' }],
  ['bad email', { ...base, email: 'not-an-email' }], ['bad IBAN', { ...base, iban: 'SA12' }], ['name too long', { name_ar: 'ع'.repeat(300) }], ['name not text', { name_ar: 123 }], ['empty name', { name_ar: '   ' }],
  ['unknown field', { ...base, is_admin: true }], ['branch_id not integer', { ...base, branch_id: 'x' }], ['branch_id negative', { ...base, branch_id: -1 }], ['unknown branch code', { ...base, branch: 'NOPE' }],
  ['array body', [1, 2]], ['notes not text', { ...base, notes: { a: 1 } }]
];
for (const [n, b] of cases) { const r = await call('POST', '/api/employees', b); ck(`POST ${n} -> 400, safe message`, r.status === 400 && !LEAK.test(r.text), r.status + ' ' + r.text.slice(0, 120)); }
const good = await call('POST', '/api/employees', { ...base, basic_salary: '5000.50', iban: 'SA03 8000 0000 6080 1016 7519', hire_date: '2026-01-15', email: `v${T}@example.test` });
ck('valid employee accepted (IBAN spaces normalised)', good.status === 200 && JSON.parse(good.text).iban === 'SA0380000000608010167519', good.text.slice(0, 160));
const id = JSON.parse(good.text).id;
for (const [n, b] of [['PUT salary NaN', { basic_salary: 'x' }], ['PUT bad status', { status: 'x' }], ['PUT changing employee_no', { employee_no: 'EMP-9999' }], ['PUT unknown field', { role: 'admin' }]])
  { const r = await call('PUT', '/api/employees/' + id, b); ck(`${n} -> 400`, r.status === 400 && !LEAK.test(r.text), r.status + ' ' + r.text.slice(0, 100)); }
ck('PUT valid partial update keeps other fields', await (async () => { const r = await call('PUT', '/api/employees/' + id, { job_title: 'محاسب' }); const o = JSON.parse(r.text); return r.status === 200 && o.job_title === 'محاسب' && o.name_ar === base.name_ar && Number(o.basic_salary) === 5000.5; })());
ck('PUT unknown id -> 404', (await call('PUT', '/api/employees/99999999', { job_title: 'x' })).status === 404);
const dup = await call('POST', '/api/employees', { ...base, employee_no: JSON.parse(good.text).employee_no });
ck('duplicate employee_no -> 409 with a safe message', dup.status === 409 && !LEAK.test(dup.text), dup.status + ' ' + dup.text);
const gen1 = JSON.parse((await call('POST', '/api/employees', base)).text), del = await call('DELETE', '/api/employees/' + gen1.id), gen2 = JSON.parse((await call('POST', '/api/employees', base)).text);
const nn = x => Number(String(x).replace(/\D/g, ''));
ck('auto number after a deletion: no clash and never below the highest existing number (max+1, not count+1)', del.status === 200 && gen2.id && nn(gen2.employee_no) > nn(JSON.parse(good.text).employee_no), gen1.employee_no + ' ' + gen2.employee_no);
const dbErr = await call('POST', '/api/accounts', { code: '1110', name_ar: 'x', name_en: 'x', type: 'asset' });
ck('a database constraint error elsewhere does not leak internals either', dbErr.status >= 400 && !LEAK.test(dbErr.text), dbErr.status + ' ' + dbErr.text.slice(0, 140));
for (const e of [id, gen2.id]) await call('DELETE', '/api/employees/' + e);
console.log(failed ? `\n${failed} FAILED` : '\nALL HR VALIDATION CHECKS PASSED'); process.exit(failed ? 1 : 0);
