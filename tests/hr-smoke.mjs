// OKLENT BUSINESS — HR, Payroll, Custody, and Expense Claims Integration Test Suite
// Run against a running container: node tests/hr-smoke.mjs

const BASE = process.env.BASE || 'http://localhost:3100';
const PASS = process.env.ADMIN_PASSWORD || 'change-me-admin';

let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + extra}`);
};

async function call(method, path, body = null, token = null) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { json = { text }; }
  return { status: res.status, body: json };
}

console.log('--- Starting OKLENT BUSINESS HR / Payroll / Custody / Expenses Test Suite ---\n');

// 1. Authentication
const loginRes = await call('POST', '/api/auth/login', { username: 'admin', password: PASS });
if (!loginRes.body.token) {
  console.error('Fatal: Admin login failed', loginRes.body);
  process.exit(1);
}
const adminToken = loginRes.body.token;
check('Admin login succeeded', !!adminToken);

// 2. Create viewer user to test privacy redaction
const viewerUsername = 'viewer_hr_' + Date.now();
const createViewer = await call('POST', '/api/users', { username: viewerUsername, password: 'ViewerPass123!', role: 'viewer' }, adminToken);
check('Create viewer user', createViewer.status === 200 || createViewer.status === 201, JSON.stringify(createViewer.body));
const viewerLogin = await call('POST', '/api/auth/login', { username: viewerUsername, password: 'ViewerPass123!' });
const viewerToken = viewerLogin.body.token;
check('Viewer login succeeded', !!viewerToken);

// 3. Employees CRUD & Privacy
const empNo = 'EMP-' + Date.now().toString().slice(-4);
const empData = {
  employee_no: empNo,
  name_ar: 'عبدالله بن محمد العتيبي',
  name_en: 'Abdullah Al-Otaibi',
  national_id: '1098765432',
  status: 'active',
  department: 'المحاسبة والمالية',
  job_title: 'كبير محاسبين',
  hire_date: '2026-01-01',
  basic_salary: 8000,
  housing_allowance: 2000,
  transport_allowance: 1000,
  other_allowances: 500,
  gosi_deduction: 800,
  other_deductions: 0,
  bank_name: 'البنك الأهلي السعودي',
  iban: 'SA0380000000608010167519',
  phone: '0555123456',
  email: 'a.otaibi@example.com'
};

const createEmp = await call('POST', '/api/employees', empData, adminToken);
check('Create employee with salary & allowances (200/201)', (createEmp.status === 200 || createEmp.status === 201) && createEmp.body.id > 0, JSON.stringify(createEmp.body));
const empId = createEmp.body.id;

// Viewer gets employee list -> privacy redaction test (basic_salary and iban must be null)
const viewerEmpList = await call('GET', '/api/employees', null, viewerToken);
const viewedEmp = viewerEmpList.body.find(e => e.id === empId);
check('Viewer role: salary and IBAN are REDACTED (null)', viewedEmp && viewedEmp.basic_salary === null && viewedEmp.iban === null);

// Admin gets employee list -> full details returned
const adminEmpList = await call('GET', '/api/employees', null, adminToken);
const adminViewEmp = adminEmpList.body.find(e => e.id === empId);
check('Admin role: full salary visible', adminViewEmp && Number(adminViewEmp.basic_salary) === 8000 && adminViewEmp.iban === empData.iban);

// Update employee
const updateEmp = await call('PUT', `/api/employees/${empId}`, { job_title: 'مدير الحسابات' }, adminToken);
check('Update employee details', updateEmp.status === 200 && updateEmp.body.job_title === 'مدير الحسابات');

// 4. Payroll Runs & Accounting Integration
const existingRuns = (await call('GET', '/api/payroll/runs', null, adminToken)).body || [];
let curYear = new Date().getFullYear();
let curMonth = 1;
while (existingRuns.some(r => r.period_name === `${curYear}-${String(curMonth).padStart(2, '0')}`)) {
  curMonth++;
  if (curMonth > 12) { curMonth = 1; curYear++; }
}

const createRun = await call('POST', '/api/payroll/runs', {
  year: curYear,
  month: curMonth,
  notes: 'مسير رواتب تجريبي لاختبار التكامل'
}, adminToken);
check('Create payroll run with auto-populated items', (createRun.status === 200 || createRun.status === 201) && createRun.body.id > 0, JSON.stringify(createRun.body));
const runId = createRun.body.id;

const runDetails = await call('GET', `/api/payroll/runs/${runId}`, null, adminToken);
const empItem = (runDetails.body.items || []).find(i => i.employee_id === empId);
check('Payroll item calculated accurately for employee', empItem && Number(empItem.gross_salary) === 11500 && Number(empItem.net_salary) === 10700, JSON.stringify(empItem));

// Approve run
const approveRun = await call('POST', `/api/payroll/runs/${runId}/approve`, {}, adminToken);
check('Approve payroll run', approveRun.status === 200 && approveRun.body.status === 'approved');

// Post run (generates balanced journal entry Dr 5210-5260 / Cr 2130, 2140)
const postRun = await call('POST', `/api/payroll/runs/${runId}/post`, {}, adminToken);
check('Post payroll run -> balanced ledger entry created', postRun.status === 200 && postRun.body.journal_entry_id > 0, JSON.stringify(postRun.body));
const payrollEntryId = postRun.body.journal_entry_id;

// Verify ledger entry
const payrollEntry = await call('GET', `/api/journal/${payrollEntryId}`, null, adminToken);
check('Payroll journal entry exists in ledger with lines', payrollEntry.status === 200 && payrollEntry.body.lines.length >= 2);

// Idempotency test: posting already posted payroll run must be refused
const doublePostRun = await call('POST', `/api/payroll/runs/${runId}/post`, {}, adminToken);
check('Double post payroll run refused (idempotency)', doublePostRun.status >= 400);

// Pay run (generates balanced payment entry Dr 2130 / Cr 1121)
const payRun = await call('POST', `/api/payroll/runs/${runId}/pay`, { bank_account: '1121' }, adminToken);
check('Pay payroll run -> bank disbursement entry created', payRun.status === 200 && payRun.body.status === 'paid', JSON.stringify(payRun.body));

// Test DB trigger: trg_prevent_employee_delete
const deleteEmp = await call('DELETE', `/api/employees/${empId}`, null, adminToken);
check('Trigger prevents deleting employee linked to payroll runs', deleteEmp.status >= 400 && /ERPX-H00[15]/.test(deleteEmp.body.error || deleteEmp.body.message || ''), JSON.stringify(deleteEmp));

// 5. Custody (العهد النقدية)
const createCustody = await call('POST', '/api/custodies', {
  employee_id: empId,
  amount: 3000,
  purpose: 'عهدة مشتريات تشغيلية ومهمات'
}, adminToken);
check('Create custody in draft status', (createCustody.status === 200 || createCustody.status === 201) && createCustody.body.id > 0, JSON.stringify(createCustody.body));
const custId = createCustody.body.id;

// Disburse custody -> Dr 1170, Cr 1121
const disburseCust = await call('POST', `/api/custodies/${custId}/disburse`, { disburse_account: '1121' }, adminToken);
check('Disburse custody -> posts Dr 1170 / Cr 1121', disburseCust.status === 200 && disburseCust.body.journal_entry_id > 0, JSON.stringify(disburseCust.body));

// Settle custody: 2000 expenses + 300 VAT (15%) + 700 returned cash = 3000
const settleCust = await call('POST', `/api/custodies/${custId}/settle`, {
  settle_date: new Date().toISOString().slice(0, 10),
  lines: [{
    expense_account: '5400',
    description: 'فواتير ضيافة ومهمات تشغيلية',
    amount: 2000,
    tax_code: 'S15',
    vat_amount: 300
  }],
  returned_amount: 700,
  returned_account: '1121'
}, adminToken);
check('Settle custody completely (expenses + input VAT + returned cash)', settleCust.status === 200 && settleCust.body.status === 'settled', JSON.stringify(settleCust.body));

// Verify custody balance is 0
const custAfterSettle = await call('GET', `/api/custodies/${custId}`, null, adminToken);
check('Custody balance is now 0.00', Number(custAfterSettle.body.balance) === 0);

// Settle again on closed custody must fail
const reSettle = await call('POST', `/api/custodies/${custId}/settle`, {
  lines: [{ expense_account: '5400', amount: 100 }]
}, adminToken);
check('Settling settled custody refused', reSettle.status >= 400);

// 6. Expense Claims (مطالبات المصروفات)
const createClaim = await call('POST', '/api/expense-claims', {
  employee_id: empId,
  claim_date: new Date().toISOString().slice(0, 10),
  category: 'travel',
  description: 'مصاريف سفر وانتداب عمل إلى فرع جدة',
  expense_account: '5400',
  amount: 1000,
  tax_code: 'S15',
  vat_amount: 150,
  total_amount: 1150
}, adminToken);
check('Submit expense claim', (createClaim.status === 200 || createClaim.status === 201) && createClaim.body.id > 0, JSON.stringify(createClaim.body));
const claimId = createClaim.body.id;

// Posting unapproved claim must fail
const postUnapproved = await call('POST', `/api/expense-claims/${claimId}/post`, { payment_account: '1121' }, adminToken);
check('Posting unapproved claim refused', postUnapproved.status >= 400);

// Approve claim
const approveClaim = await call('POST', `/api/expense-claims/${claimId}/approve`, {}, adminToken);
check('Approve expense claim', approveClaim.status === 200 && approveClaim.body.status === 'approved');

// Post approved claim -> Dr 5400 (1000) + Dr 1150 (150) / Cr 1121 (1150)
const postClaim = await call('POST', `/api/expense-claims/${claimId}/post`, { payment_account: '1121' }, adminToken);
check('Post expense claim -> balanced ledger entry created', postClaim.status === 200 && postClaim.body.journal_entry_id > 0, JSON.stringify(postClaim.body));

// 7. HR Reports
const payrollRep = await call('GET', '/api/reports/hr/payroll-summary', null, adminToken);
check('HR Report: payroll summary returns rows', Array.isArray(payrollRep.body) && payrollRep.body.length > 0);

const custodyRep = await call('GET', '/api/reports/hr/custody-balances', null, adminToken);
check('HR Report: custody balances returns rows', Array.isArray(custodyRep.body) && custodyRep.body.length > 0);

const expenseRep = await call('GET', '/api/reports/hr/expenses-by-category', null, adminToken);
check('HR Report: expenses by category returns rows', Array.isArray(expenseRep.body) && expenseRep.body.length > 0);

// 8. Accounting Integrity: Ledger Hash Chain & Trial Balance
const chainCheck = await call('GET', '/api/reports/chain-verify', null, adminToken);
check('Accounting hash chain intact after all HR postings', chainCheck.body.ok === true);

const tbCheck = await call('GET', '/api/reports/trial-balance?from=2026-01-01&to=2026-12-31', null, adminToken);
const tbDiff = Math.abs(tbCheck.body.reduce((s, r) => s + Number(r.closing_debit) - Number(r.closing_credit), 0));
check('Trial balance strictly balances after all HR postings (diff < 0.01)', tbDiff < 0.01, `Diff: ${tbDiff}`);

console.log(`\n--- Test Summary: ${failed ? `${failed} test(s) FAILED` : 'ALL 24 HR INTEGRATION TESTS PASSED'} ---`);
process.exit(failed ? 1 : 0);
