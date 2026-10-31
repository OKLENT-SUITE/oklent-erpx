// OKLENT BUSINESS — HR, Payroll, Custody and Expenses API routes
// Strict accounting integration via post_entry / stored procedures.

export function registerHR({ app, route, auth, q, tx, httpErr, dateOr, today }) {

  // ================= HR MASTER SETTINGS + ORGANIZATION =================
  const HR_CATALOGS = {
    contracts: 'hr_contract_types',
    salaries: 'hr_salary_structures',
    schedules: 'hr_work_schedules'
  };
  route('GET', '/api/hr/settings', 'accountant', async () => {
    const [contracts, salaries, schedules, employees] = await Promise.all([
      q('SELECT * FROM hr_contract_types ORDER BY name_ar'),
      q('SELECT * FROM hr_salary_structures ORDER BY name_ar'),
      q('SELECT * FROM hr_work_schedules ORDER BY name_ar'),
      q(`SELECT e.id,e.employee_no,e.name_ar,e.job_title,e.department,e.status,e.manager_employee_id,e.contract_type_id,e.salary_structure_id,e.work_schedule_id,m.name_ar manager_name
         FROM employees e LEFT JOIN employees m ON m.id=e.manager_employee_id ORDER BY e.name_ar`)
    ]);
    return { contracts: contracts.rows, salaries: salaries.rows, schedules: schedules.rows, employees: employees.rows };
  });
  route('POST', '/api/hr/settings/:kind', 'accountant', async req => {
    const table = HR_CATALOGS[req.params.kind]; if (!table) throw httpErr(404, 'unknown HR setting');
    const b = req.body || {}, name = typeof b.name_ar === 'string' ? b.name_ar.trim() : '';
    if (!name || name.length > 120) throw httpErr(400, 'أدخل اسمًا صحيحًا لا يتجاوز 120 حرفًا');
    if (typeof (b.details || '') !== 'string' || (b.details || '').length > 2000) throw httpErr(400, 'التفاصيل غير صالحة');
    if (!b.settings || typeof b.settings !== 'object' || Array.isArray(b.settings)) throw httpErr(400, 'بيانات الإعداد غير صالحة');
    return tx(req.user.username, async c => (await c.query(`INSERT INTO ${table}(name_ar,details,settings) VALUES($1,$2,$3::jsonb) RETURNING *`, [name,b.details||'',JSON.stringify(b.settings)])).rows[0]);
  });
  route('PUT', '/api/hr/settings/:kind/:id', 'accountant', async req => {
    const table = HR_CATALOGS[req.params.kind], id = Number(req.params.id); if (!table) throw httpErr(404, 'unknown HR setting');
    const b = req.body || {}, name = typeof b.name_ar === 'string' ? b.name_ar.trim() : '';
    if (!Number.isInteger(id) || id < 1 || !name || name.length > 120 || typeof (b.details || '') !== 'string' || (b.details || '').length > 2000 || !b.settings || typeof b.settings !== 'object' || Array.isArray(b.settings)) throw httpErr(400, 'بيانات الإعداد غير صالحة');
    return tx(req.user.username, async c => { const r = await c.query(`UPDATE ${table} SET name_ar=$1,details=$2,settings=$3::jsonb,updated_at=now() WHERE id=$4 RETURNING *`,[name,b.details||'',JSON.stringify(b.settings),id]); if (!r.rowCount) throw httpErr(404,'setting not found'); return r.rows[0]; });
  });
  route('DELETE', '/api/hr/settings/:kind/:id', 'accountant', async req => {
    const table = HR_CATALOGS[req.params.kind], id = Number(req.params.id); if (!table) throw httpErr(404, 'unknown HR setting');
    if (!Number.isInteger(id) || id < 1) throw httpErr(400, 'invalid setting id');
    const r = await q(`DELETE FROM ${table} WHERE id=$1`,[id]); if (!r.rowCount) throw httpErr(404,'setting not found'); return { ok:true };
  });
  route('PUT', '/api/employees/:id/hr-settings', 'accountant', async req => {
    const id=Number(req.params.id), b=req.body||{}; if(!Number.isInteger(id)||id<1) throw httpErr(400,'invalid employee id');
    const ref=(v,n)=>{if(v===''||v===undefined||v===null)return null;const x=Number(v);if(!Number.isInteger(x)||x<1)throw httpErr(400,`${n} must be a positive integer`);return x;};
    const manager=ref(b.manager_employee_id,'manager_employee_id'), contract=ref(b.contract_type_id,'contract_type_id'), salary=ref(b.salary_structure_id,'salary_structure_id'), schedule=ref(b.work_schedule_id,'work_schedule_id');
    return tx(req.user.username,async c=>{
      const {rows:[emp]}=await c.query('SELECT id FROM employees WHERE id=$1 FOR UPDATE',[id]); if(!emp)throw httpErr(404,'employee not found');
      if(manager===id)throw httpErr(400,'لا يمكن تعيين الموظف مديرًا مباشرًا لنفسه');
      if(manager){const exists=await c.query('SELECT 1 FROM employees WHERE id=$1',[manager]);if(!exists.rowCount)throw httpErr(400,'الموظف المحدد كمدير غير موجود');}
      if(manager){const {rows:[cycle]}=await c.query(`WITH RECURSIVE chain AS (SELECT manager_employee_id id FROM employees WHERE id=$1 UNION ALL SELECT e.manager_employee_id FROM employees e JOIN chain c ON e.id=c.id WHERE e.manager_employee_id IS NOT NULL) SELECT 1 FROM chain WHERE id=$2 LIMIT 1`,[manager,id]);if(cycle)throw httpErr(400,'هذا الاختيار ينشئ دورة في الهيكل التنظيمي');}
      const checks=[['hr_contract_types',contract],['hr_salary_structures',salary],['hr_work_schedules',schedule]];
      for(const [table,value] of checks)if(value){const found=await c.query(`SELECT 1 FROM ${table} WHERE id=$1 AND is_active`,[value]);if(!found.rowCount)throw httpErr(400,'اختر إعدادًا نشطًا مسجلًا');}
      return (await c.query(`UPDATE employees SET manager_employee_id=$1,contract_type_id=$2,salary_structure_id=$3,work_schedule_id=$4,updated_at=now() WHERE id=$5 RETURNING id,manager_employee_id,contract_type_id,salary_structure_id,work_schedule_id`,[manager,contract,salary,schedule,id])).rows[0];
    });
  });

  // ================= EMPLOYEES =================
  // SEC-01: personal / financial HR data is an ALLOWLIST by role. Only accountant and admin receive the full record;
  // every other role (viewer, cashier, any future role) gets the minimum operational directory. Forbidden fields are
  // NOT selected at all (never present as null), so they cannot leak even when the database holds a value.
  const HR_FULL_ROLES = new Set(['accountant', 'admin']);
  const EMP_MIN_COLS = `e.id, e.employee_no, e.name_ar, e.name_en, e.status, e.branch_id, b.name_ar AS branch_name, e.department, e.job_title, e.manager_employee_id`;
  const EMP_FULL_COLS = `e.id, e.employee_no, e.name_ar, e.name_en, e.national_id, e.status, e.branch_id,
             b.name_ar AS branch_name, e.department, e.job_title, e.cost_center, e.hire_date,
             e.termination_date, e.phone, e.email, e.payment_method, e.notes, e.attachments, e.created_at,
             e.basic_salary, e.housing_allowance, e.transport_allowance, e.other_allowances,
             e.manager_employee_id,e.contract_type_id,e.salary_structure_id,e.work_schedule_id,
             e.gosi_deduction, e.other_deductions, e.bank_name, e.iban`;
  const empCols = req => (HR_FULL_ROLES.has(req.user.role) ? EMP_FULL_COLS : EMP_MIN_COLS);

  route('GET', '/api/employees', 'viewer', async req => {
    const { rows } = await q(`
      SELECT ${empCols(req)}
      FROM employees e
      LEFT JOIN branches b ON b.id = e.branch_id
      ORDER BY e.id DESC
    `);
    return rows;
  });

  route('GET', '/api/employees/:id', 'viewer', async req => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw httpErr(400, 'invalid employee id');
    const { rows: [e] } = await q(`
      SELECT ${empCols(req)}
      FROM employees e
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE e.id = $1
    `, [id]);
    if (!e) throw httpErr(404, 'employee not found');
    return e;
  });

  // ---- API-01: one validator for every employee write. Unknown / malformed input is refused with 400 (never NaN, never a raw DB error). ----
  const bad = m => httpErr(400, m);
  const optStr = (v, name, max) => { if (v === undefined || v === null || v === '') return null; if (typeof v !== 'string') throw bad(`${name} must be text`); const t = v.trim(); if (t.length > max) throw bad(`${name} is too long (max ${max})`); return t || null; };
  const optMoney = (v, name) => { if (v === undefined || v === null || v === '') return undefined; const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,10}(\.\d{1,2})?$/.test(v.trim()) ? Number(v) : NaN);
    if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999.99 || Math.round(n * 100) !== n * 100 && Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw bad(`${name} must be a non-negative amount with at most 2 decimals`); return n; };
  const optDate = (v, name) => { if (v === undefined || v === null || v === '') return null; if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw bad(`${name} must be a valid date YYYY-MM-DD`); return v; };
  const optEnum = (v, name, list) => { if (v === undefined || v === null || v === '') return null; if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`); return v; };
  const EMP_FIELDS = ['employee_no', 'name_ar', 'name_en', 'national_id', 'status', 'branch_id', 'branch', 'department', 'job_title', 'cost_center', 'hire_date', 'termination_date', 'phone', 'email',
    'basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowances', 'gosi_deduction', 'other_deductions', 'bank_name', 'iban', 'payment_method', 'notes'];
  const MONEY = ['basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowances', 'gosi_deduction', 'other_deductions'];
  function parseEmployee(b, { create }) {
    if (b === null || typeof b !== 'object' || Array.isArray(b)) throw bad('JSON object body required');
    const unknown = Object.keys(b).filter(k => !EMP_FIELDS.includes(k)); if (unknown.length) throw bad('unknown field(s): ' + unknown.slice(0, 5).join(', '));
    const o = { employee_no: optStr(b.employee_no, 'employee_no', 32), name_ar: optStr(b.name_ar, 'name_ar', 255), name_en: optStr(b.name_en, 'name_en', 255), national_id: optStr(b.national_id, 'national_id', 32),
      status: optEnum(b.status, 'status', ['active', 'suspended', 'terminated']), department: optStr(b.department, 'department', 100), job_title: optStr(b.job_title, 'job_title', 100), cost_center: optStr(b.cost_center, 'cost_center', 50),
      hire_date: optDate(b.hire_date, 'hire_date'), termination_date: optDate(b.termination_date, 'termination_date'), phone: optStr(b.phone, 'phone', 32), email: optStr(b.email, 'email', 128),
      bank_name: optStr(b.bank_name, 'bank_name', 100), iban: optStr(b.iban, 'iban', 34), payment_method: optEnum(b.payment_method, 'payment_method', ['bank', 'cash']), notes: optStr(b.notes, 'notes', 5000) };
    if (create && !o.name_ar) throw bad('name_ar is required');
    if (b.name_ar !== undefined && !o.name_ar) throw bad('name_ar cannot be empty');
    if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) throw bad('email is not valid');
    if (o.iban && !/^SA\d{22}$/.test(o.iban.replace(/\s/g, ''))) throw bad('iban must be a Saudi IBAN (SA + 22 digits)'); if (o.iban) o.iban = o.iban.replace(/\s/g, '');
    if (o.hire_date && o.termination_date && o.termination_date < o.hire_date) throw bad('termination_date is before hire_date');
    for (const k of MONEY) o[k] = optMoney(b[k], k);
    if (b.branch_id !== undefined && b.branch_id !== null && b.branch_id !== '') { const n = Number(b.branch_id); if (!Number.isInteger(n) || n < 1) throw bad('branch_id must be a positive integer'); o.branch_id = n; }
    o.branch = optStr(b.branch, 'branch', 20);
    return o;
  }
  const resolveBranch = async (o, c) => o.branch_id ?? (o.branch ? ((await c.query('SELECT id FROM branches WHERE code=$1', [o.branch])).rows[0]?.id ?? (() => { throw bad('unknown branch code'); })()) : null);
  const dupEmpNo = e => (e.code === '23505' && /employee_no/.test(e.constraint || e.message || '') ? httpErr(409, 'employee_no already exists') : e);

  route('POST', '/api/employees', 'accountant', async req => {
    const o = parseEmployee(req.body, { create: true });
    try {
      return await tx(req.user.username, async c => {
        // DATA-01: automatic numbers are allocated under a transaction-scoped advisory lock from max(existing EMP-nnnn) + 1, never from count(*)
        // (count breaks after a delete and races under concurrency). Two concurrent creations queue here; the UNIQUE constraint remains the last line of defence.
        let empNo = o.employee_no;
        if (!empNo) {
          await c.query('SELECT pg_advisory_xact_lock(727002)');
          const { rows: [{ n }] } = await c.query("SELECT coalesce(max((substring(employee_no from '^EMP-(\\d+)$'))::int), 0) AS n FROM employees WHERE employee_no ~ '^EMP-\\d+$'");
          empNo = 'EMP-' + String(n + 1).padStart(4, '0');
        }
        const branchId = await resolveBranch(o, c);
        const { rows: [emp] } = await c.query(`
          INSERT INTO employees (employee_no, name_ar, name_en, national_id, status, branch_id, department, job_title, cost_center, hire_date, termination_date, phone, email,
            basic_salary, housing_allowance, transport_allowance, other_allowances, gosi_deduction, other_deductions, bank_name, iban, payment_method, notes, created_by)
          VALUES ($1,$2,$3,$4,coalesce($5,'active'),$6,$7,$8,$9,coalesce($10::date,current_date),$11,$12,$13,coalesce($14::numeric,0),coalesce($15::numeric,0),coalesce($16::numeric,0),coalesce($17::numeric,0),coalesce($18::numeric,0),coalesce($19::numeric,0),$20,$21,coalesce($22,'bank'),$23,$24)
          RETURNING *`, [empNo, o.name_ar, o.name_en, o.national_id, o.status, branchId, o.department, o.job_title, o.cost_center, o.hire_date, o.termination_date, o.phone, o.email,
          o.basic_salary, o.housing_allowance, o.transport_allowance, o.other_allowances, o.gosi_deduction, o.other_deductions, o.bank_name, o.iban, o.payment_method, o.notes, req.user.username]);
        return emp;
      });
    } catch (e) { throw dupEmpNo(e); }
  });

  route('PUT', '/api/employees/:id', 'accountant', async req => {
    const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw bad('invalid employee id');
    const o = parseEmployee(req.body, { create: false });
    if (o.employee_no) throw bad('employee_no cannot be changed');
    try {
      return await tx(req.user.username, async c => {
        const branchId = await resolveBranch(o, c);
        const { rows: [emp] } = await c.query(`
          UPDATE employees SET name_ar=coalesce($1,name_ar), name_en=coalesce($2,name_en), national_id=coalesce($3,national_id), status=coalesce($4,status), branch_id=coalesce($5,branch_id),
            department=coalesce($6,department), job_title=coalesce($7,job_title), cost_center=coalesce($8,cost_center), hire_date=coalesce($9::date,hire_date), termination_date=coalesce($10::date,termination_date),
            phone=coalesce($11,phone), email=coalesce($12,email), basic_salary=coalesce($13::numeric,basic_salary), housing_allowance=coalesce($14::numeric,housing_allowance), transport_allowance=coalesce($15::numeric,transport_allowance),
            other_allowances=coalesce($16::numeric,other_allowances), gosi_deduction=coalesce($17::numeric,gosi_deduction), other_deductions=coalesce($18::numeric,other_deductions), bank_name=coalesce($19,bank_name), iban=coalesce($20,iban),
            payment_method=coalesce($21,payment_method), notes=coalesce($22,notes), updated_at=now()
          WHERE id=$23 RETURNING *`, [o.name_ar, o.name_en, o.national_id, o.status, branchId, o.department, o.job_title, o.cost_center, o.hire_date, o.termination_date, o.phone, o.email,
          o.basic_salary, o.housing_allowance, o.transport_allowance, o.other_allowances, o.gosi_deduction, o.other_deductions, o.bank_name, o.iban, o.payment_method, o.notes, id]);
        if (!emp) throw httpErr(404, 'employee not found');
        return emp;
      });
    } catch (e) { throw dupEmpNo(e); }
  });

  route('DELETE', '/api/employees/:id', 'accountant', async req => {
    // Triggers will prevent deletion if the employee is referenced in payroll/custody/expenses
    const { rowCount } = await q('DELETE FROM employees WHERE id = $1', [req.params.id]);
    if (!rowCount) throw httpErr(404, 'employee not found');
    return { ok: true };
  });


  // ================= PAYROLL =================
  route('GET', '/api/payroll/runs', 'accountant', async () => {
    const { rows } = await q(`
      SELECT pr.*, b.name_ar AS branch_name, je.entry_no AS journal_entry_no, pe.entry_no AS payment_entry_no
      FROM payroll_runs pr
      LEFT JOIN branches b ON b.id = pr.branch_id
      LEFT JOIN journal_entries je ON je.id = pr.journal_entry_id
      LEFT JOIN journal_entries pe ON pe.id = pr.payment_entry_id
      ORDER BY pr.period_name DESC, pr.id DESC
    `);
    return rows;
  });

  route('GET', '/api/payroll/runs/:id', 'accountant', async req => {
    const isRestricted = req.user.role === 'viewer';
    const { rows: [run] } = await q(`
      SELECT pr.*, b.name_ar AS branch_name, je.entry_no AS journal_entry_no, pe.entry_no AS payment_entry_no
      FROM payroll_runs pr
      LEFT JOIN branches b ON b.id = pr.branch_id
      LEFT JOIN journal_entries je ON je.id = pr.journal_entry_id
      LEFT JOIN journal_entries pe ON pe.id = pr.payment_entry_id
      WHERE pr.id = $1
    `, [req.params.id]);
    if (!run) throw httpErr(404, 'payroll run not found');

    const { rows: items } = await q(`
      SELECT pi.id, pi.employee_id, e.employee_no, e.name_ar AS employee_name, e.department, e.job_title,
             ${isRestricted ? 'NULL::numeric' : 'pi.basic_salary'} AS basic_salary,
             ${isRestricted ? 'NULL::numeric' : 'pi.housing_allowance'} AS housing_allowance,
             ${isRestricted ? 'NULL::numeric' : 'pi.transport_allowance'} AS transport_allowance,
             ${isRestricted ? 'NULL::numeric' : 'pi.other_allowances'} AS other_allowances,
             ${isRestricted ? 'NULL::numeric' : 'pi.gross_salary'} AS gross_salary,
             ${isRestricted ? 'NULL::numeric' : 'pi.gosi_employee'} AS gosi_employee,
             ${isRestricted ? 'NULL::numeric' : 'pi.advances_deduction'} AS advances_deduction,
             ${isRestricted ? 'NULL::numeric' : 'pi.other_deductions'} AS other_deductions,
             ${isRestricted ? 'NULL::numeric' : 'pi.total_deductions'} AS total_deductions,
             ${isRestricted ? 'NULL::numeric' : 'pi.net_salary'} AS net_salary,
             pi.payment_status, pi.notes
      FROM payroll_items pi
      JOIN employees e ON e.id = pi.employee_id
      WHERE pi.payroll_run_id = $1
      ORDER BY e.employee_no ASC
    `, [req.params.id]);

    run.items = items;
    return run;
  });

  route('POST', '/api/payroll/runs', 'accountant', async req => {
    const b = req.body || {};
    let period = b.period_name;
    if (!period && b.year && b.month) {
      period = `${b.year}-${String(b.month).padStart(2, '0')}`;
    }
    if (!period) period = today().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) throw httpErr(400, 'period_name must be YYYY-MM');

    const branchId = b.branch_id ? Number(b.branch_id) : (b.branch ? (await q('SELECT id FROM branches WHERE code=$1', [b.branch])).rows[0]?.id : null);
    const title = b.title_ar || `مسير رواتب شهر ${period}`;
    const runNo = 'PAY-' + period + (branchId ? '-' + branchId : '');

    return tx(req.user.username, async client => {
      // Check duplicate
      const { rows: [dup] } = await client.query('SELECT id FROM payroll_runs WHERE period_name = $1 AND coalesce(branch_id, 0) = coalesce($2, 0)', [period, branchId]);
      if (dup) throw httpErr(422, `ERPX-H008: payroll run for period ${period} already exists`);

      // Create run header
      const { rows: [run] } = await client.query(`
        INSERT INTO payroll_runs (run_no, period_name, branch_id, title_ar, status, notes, created_by)
        VALUES ($1, $2, $3, $4, 'draft', $5, $6) RETURNING *
      `, [runNo, period, branchId, title, b.notes || null, req.user.username]);

      // Populate active employees for this branch (or all branches if branchId is null)
      const { rows: emps } = await client.query(`
        SELECT * FROM employees
        WHERE status = 'active' AND ($1::int IS NULL OR branch_id = $1)
      `, [branchId]);

      let totBasic = 0, totAllow = 0, totDeduct = 0, totNet = 0;
      for (const e of emps) {
        const basic = Number(e.basic_salary || 0);
        const house = Number(e.housing_allowance || 0);
        const trans = Number(e.transport_allowance || 0);
        const otherA = Number(e.other_allowances || 0);
        const gross = basic + house + trans + otherA;

        const gosi = Number(e.gosi_deduction || 0);
        const adv = 0;
        const otherD = Number(e.other_deductions || 0);
        const deduct = gosi + adv + otherD;
        const net = Math.max(0, gross - deduct);

        totBasic += basic;
        totAllow += (house + trans + otherA);
        totDeduct += deduct;
        totNet += net;

        await client.query(`
          INSERT INTO payroll_items (
            payroll_run_id, employee_id, basic_salary, housing_allowance, transport_allowance,
            other_allowances, gross_salary, gosi_employee, advances_deduction, other_deductions,
            total_deductions, net_salary, payment_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'unpaid')
        `, [run.id, e.id, basic, house, trans, otherA, gross, gosi, adv, otherD, deduct, net]);
      }

      await client.query(`
        UPDATE payroll_runs SET
          total_basic = $1, total_allowances = $2, total_deductions = $3,
          total_net = $4, employee_count = $5
        WHERE id = $6
      `, [totBasic, totAllow, totDeduct, totNet, emps.length, run.id]);

      run.total_basic = totBasic;
      run.total_allowances = totAllow;
      run.total_deductions = totDeduct;
      run.total_net = totNet;
      run.employee_count = emps.length;
      return run;
    });
  });

  route('PUT', '/api/payroll/runs/:id/items/:itemId', 'accountant', async req => {
    const b = req.body || {};
    return tx(req.user.username, async client => {
      const { rows: [run] } = await client.query('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!run) throw httpErr(404, 'payroll run not found');
      if (run.status !== 'draft') throw httpErr(422, 'can only edit items in draft payroll runs');

      const { rows: [it] } = await client.query('SELECT * FROM payroll_items WHERE id = $1 AND payroll_run_id = $2', [req.params.itemId, req.params.id]);
      if (!it) throw httpErr(404, 'payroll item not found');

      const basic = b.basic_salary !== undefined ? Number(b.basic_salary) : Number(it.basic_salary);
      const house = b.housing_allowance !== undefined ? Number(b.housing_allowance) : Number(it.housing_allowance);
      const trans = b.transport_allowance !== undefined ? Number(b.transport_allowance) : Number(it.transport_allowance);
      const otherA = b.other_allowances !== undefined ? Number(b.other_allowances) : Number(it.other_allowances);
      const gross = basic + house + trans + otherA;

      const gosi = b.gosi_employee !== undefined ? Number(b.gosi_employee) : Number(it.gosi_employee);
      const adv = b.advances_deduction !== undefined ? Number(b.advances_deduction) : Number(it.advances_deduction);
      const otherD = b.other_deductions !== undefined ? Number(b.other_deductions) : Number(it.other_deductions);
      const deduct = gosi + adv + otherD;
      const net = gross - deduct;

      const { rows: [updated] } = await client.query(`
        UPDATE payroll_items SET
          basic_salary = $1, housing_allowance = $2, transport_allowance = $3, other_allowances = $4,
          gross_salary = $5, gosi_employee = $6, advances_deduction = $7, other_deductions = $8,
          total_deductions = $9, net_salary = $10, notes = coalesce($11, notes)
        WHERE id = $12 RETURNING *
      `, [basic, house, trans, otherA, gross, gosi, adv, otherD, deduct, net, b.notes, req.params.itemId]);

      // Recompute run totals
      await client.query(`
        UPDATE payroll_runs SET
          total_basic = (SELECT coalesce(sum(basic_salary),0) FROM payroll_items WHERE payroll_run_id = $1),
          total_allowances = (SELECT coalesce(sum(housing_allowance+transport_allowance+other_allowances),0) FROM payroll_items WHERE payroll_run_id = $1),
          total_deductions = (SELECT coalesce(sum(total_deductions),0) FROM payroll_items WHERE payroll_run_id = $1),
          total_net = (SELECT coalesce(sum(net_salary),0) FROM payroll_items WHERE payroll_run_id = $1)
        WHERE id = $1
      `, [req.params.id]);

      return updated;
    });
  });

  route('POST', '/api/payroll/runs/:id/status', 'accountant', async req => {
    const { status, notes } = req.body || {};
    if (!['reviewed', 'approved', 'cancelled'].includes(status)) throw httpErr(400, 'invalid status');

    return tx(req.user.username, async client => {
      const { rows: [run] } = await client.query('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!run) throw httpErr(404, 'payroll run not found');

      if (status === 'reviewed') {
        if (run.status !== 'draft') throw httpErr(422, 'can only review draft runs');
        await client.query('UPDATE payroll_runs SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3', [status, req.user.username, run.id]);
      } else if (status === 'approved') {
        if (!['draft', 'reviewed'].includes(run.status)) throw httpErr(422, 'run must be draft or reviewed to approve');
        await client.query('UPDATE payroll_runs SET status = $1, approved_by = $2, approved_at = now() WHERE id = $3', [status, req.user.username, run.id]);
      } else if (status === 'cancelled') {
        if (['posted', 'paid'].includes(run.status)) throw httpErr(422, 'cannot cancel a posted or paid run');
        await client.query('UPDATE payroll_runs SET status = $1, notes = coalesce($2, notes) WHERE id = $3', [status, notes, run.id]);
      }
      return { ok: true, status };
    });
  });

  route('POST', '/api/payroll/runs/:id/approve', 'accountant', async req => {
    return tx(req.user.username, async client => {
      const { rows: [run] } = await client.query('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!run) throw httpErr(404, 'payroll run not found');
      if (!['draft', 'reviewed'].includes(run.status)) throw httpErr(422, 'run must be draft or reviewed to approve');
      await client.query('UPDATE payroll_runs SET status = $1, approved_by = $2, approved_at = now() WHERE id = $3', ['approved', req.user.username, run.id]);
      return { ok: true, status: 'approved' };
    });
  });

  route('POST', '/api/payroll/runs/:id/post', 'accountant', async req => {
    return tx(req.user.username, async client => {
      const { rows: [{ fn_post_payroll: entryId }] } = await client.query('SELECT fn_post_payroll($1, $2)', [req.params.id, req.user.username]);
      return { ok: true, journal_entry_id: entryId };
    });
  });

  route('POST', '/api/payroll/runs/:id/pay', 'accountant', async req => {
    const b = req.body || {};
    const payAccount = b.pay_account || b.bank_account || '1121';
    const payDate = dateOr(b.pay_date, today());
    return tx(req.user.username, async client => {
      const { rows: [{ fn_pay_payroll: entryId }] } = await client.query('SELECT fn_pay_payroll($1, $2, $3, $4)', [req.params.id, payAccount, payDate, req.user.username]);
      return { ok: true, status: 'paid', payment_entry_id: entryId };
    });
  });


  // ================= CUSTODY =================
  route('GET', '/api/custodies', 'accountant', async () => {
    const { rows } = await q(`
      SELECT c.*, e.employee_no, e.name_ar AS employee_name, b.name_ar AS branch_name, je.entry_no AS journal_entry_no
      FROM custodies c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN branches b ON b.id = c.branch_id
      LEFT JOIN journal_entries je ON je.id = c.journal_entry_id
      ORDER BY c.id DESC
    `);
    return rows;
  });

  route('GET', '/api/custodies/:id', 'accountant', async req => {
    const { rows: [c] } = await q(`
      SELECT c.*, e.employee_no, e.name_ar AS employee_name, b.name_ar AS branch_name, je.entry_no AS journal_entry_no
      FROM custodies c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN branches b ON b.id = c.branch_id
      LEFT JOIN journal_entries je ON je.id = c.journal_entry_id
      WHERE c.id = $1
    `, [req.params.id]);
    if (!c) throw httpErr(404, 'custody not found');

    const { rows: settlements } = await q(`
      SELECT s.*, a.name_ar AS expense_account_name, je.entry_no AS journal_entry_no
      FROM custody_settlements s
      LEFT JOIN accounts a ON a.code = s.expense_account
      LEFT JOIN journal_entries je ON je.id = s.journal_entry_id
      WHERE s.custody_id = $1
      ORDER BY s.id DESC
    `, [req.params.id]);

    c.settlements = settlements;
    return c;
  });

  route('POST', '/api/custodies', 'accountant', async req => {
    const b = req.body || {};
    if (!b.employee_id) throw httpErr(400, 'employee_id is required');
    const amt = Number(b.amount || 0);
    if (amt <= 0) throw httpErr(400, 'amount must be greater than zero');
    if (!b.purpose || !b.purpose.trim()) throw httpErr(400, 'purpose is required');

    const { rows: [{ count }] } = await q('SELECT count(*)::int AS count FROM custodies');
    const custodyNo = 'CUS-' + today().slice(0, 4) + '-' + String(count + 1).padStart(4, '0');
    const branchId = b.branch_id ? Number(b.branch_id) : (b.branch ? (await q('SELECT id FROM branches WHERE code=$1', [b.branch])).rows[0]?.id : null);
    const disDate = dateOr(b.disbursement_date, today());

    return tx(req.user.username, async client => {
      const { rows: [cus] } = await client.query(`
        INSERT INTO custodies (custody_no, employee_id, custody_type, amount, balance, disbursement_date, branch_id, purpose, notes, created_by)
        VALUES ($1, $2, coalesce($3, 'cash'), $4, $4, $5, $6, $7, $8, $9) RETURNING *
      `, [custodyNo, b.employee_id, b.custody_type, amt, disDate, branchId, b.purpose.trim(), b.notes || null, req.user.username]);

      if (b.auto_disburse) {
        const { rows: [{ fn_post_custody: entryId }] } = await client.query('SELECT fn_post_custody($1, $2, $3)', [cus.id, b.pay_account || '1110', req.user.username]);
        cus.journal_entry_id = entryId;
        cus.status = 'active';
      }
      return cus;
    });
  });

  route('PUT', '/api/custodies/:id', 'accountant', async req => {
    const b = req.body || {};
    return tx(req.user.username, async client => {
      const { rows: [cus] } = await client.query('SELECT * FROM custodies WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!cus) throw httpErr(404, 'custody not found');
      if (cus.status !== 'draft') throw httpErr(422, 'can only edit draft custodies');

      const amt = b.amount !== undefined ? Number(b.amount) : Number(cus.amount);
      const branchId = b.branch_id ? Number(b.branch_id) : (b.branch ? (await client.query('SELECT id FROM branches WHERE code=$1', [b.branch])).rows[0]?.id : cus.branch_id);
      const { rows: [updated] } = await client.query(`
        UPDATE custodies SET
          employee_id = coalesce($1, employee_id),
          custody_type = coalesce($2, custody_type),
          amount = $3,
          balance = $3,
          purpose = coalesce($4, purpose),
          notes = coalesce($5, notes),
          branch_id = $6,
          disbursement_date = coalesce($7, disbursement_date)
        WHERE id = $8 RETURNING *
      `, [b.employee_id ? Number(b.employee_id) : null, b.custody_type, amt, b.purpose, b.notes, branchId, b.disbursement_date, cus.id]);
      return updated;
    });
  });

  route('POST', '/api/custodies/:id/disburse', 'accountant', async req => {
    const b = req.body || {};
    const payAccount = b.pay_account || b.disburse_account || '1110';
    return tx(req.user.username, async client => {
      const { rows: [{ fn_post_custody: entryId }] } = await client.query('SELECT fn_post_custody($1, $2, $3)', [req.params.id, payAccount, req.user.username]);
      return { ok: true, journal_entry_id: entryId };
    });
  });

  const handleCustodySettlement = async req => {
    const b = req.body || {};
    let expAmt = 0;
    let vatAmt = 0;
    let expenseAccount = b.expense_account || null;
    let memo = b.memo || '';

    if (Array.isArray(b.lines) && b.lines.length > 0) {
      for (const l of b.lines) {
        expAmt += Number(l.amount || 0);
        vatAmt += Number(l.vat_amount || 0);
        if (!expenseAccount && l.expense_account) expenseAccount = l.expense_account;
        if (!memo && l.description) memo = l.description;
      }
    } else {
      expAmt = Number(b.expense_amount || 0);
      vatAmt = Number(b.vat_amount || 0);
    }

    const cashRet = Number(b.cash_returned || b.returned_amount || 0);
    const total = Number((expAmt + vatAmt + cashRet).toFixed(2));

    if (total <= 0) throw httpErr(400, 'total settlement must be greater than zero');
    if (expAmt > 0 && !expenseAccount) throw httpErr(400, 'expense_account is required when expense_amount > 0');
    if (!memo) memo = 'تسوية عهدة';

    return tx(req.user.username, async client => {
      const { rows: [cus] } = await client.query('SELECT * FROM custodies WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!cus) throw httpErr(404, 'custody not found');
      if (cus.status === 'closed' || Number(cus.balance) <= 0) throw httpErr(422, 'custody already settled');
      if (total > Number(cus.balance)) throw httpErr(422, `settlement amount (${total}) exceeds open custody balance (${cus.balance})`);

      const { rows: [{ count }] } = await client.query('SELECT count(*)::int AS count FROM custody_settlements');
      const stlNo = 'STL-' + today().slice(0, 4) + '-' + String(count + 1).padStart(4, '0');
      const stlDate = dateOr(b.settlement_date || b.settle_date, today());

      const { rows: [stl] } = await client.query(`
        INSERT INTO custody_settlements (settlement_no, custody_id, settlement_date, expense_amount, vat_amount, cash_returned, total_settled, expense_account, memo, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8, '5950'), $9, $10) RETURNING *
      `, [stlNo, req.params.id, stlDate, expAmt, vatAmt, cashRet, total, expenseAccount, memo.trim(), req.user.username]);

      const { rows: [{ fn_settle_custody: entryId }] } = await client.query('SELECT fn_settle_custody($1, $2)', [stl.id, req.user.username]);
      stl.journal_entry_id = entryId;

      const { rows: [updatedCus] } = await client.query('SELECT * FROM custodies WHERE id = $1', [req.params.id]);
      return {
        ok: true,
        status: updatedCus.status === 'closed' ? 'settled' : updatedCus.status,
        custody_status: updatedCus.status,
        balance: updatedCus.balance,
        settlement: stl,
        journal_entry_id: entryId
      };
    });
  };

  route('POST', '/api/custodies/:id/settlements', 'accountant', handleCustodySettlement);
  route('POST', '/api/custodies/:id/settle', 'accountant', handleCustodySettlement);


  // ================= EXPENSE CLAIMS =================
  route('GET', '/api/expense-claims', 'accountant', async () => {
    const { rows } = await q(`
      SELECT ec.*, e.employee_no, e.name_ar AS employee_name, p.name_ar AS partner_name,
             b.name_ar AS branch_name, a.name_ar AS expense_account_name, je.entry_no AS journal_entry_no
      FROM expense_claims ec
      LEFT JOIN employees e ON e.id = ec.employee_id
      LEFT JOIN partners p ON p.id = ec.partner_id
      LEFT JOIN branches b ON b.id = ec.branch_id
      LEFT JOIN accounts a ON a.code = ec.expense_account
      LEFT JOIN journal_entries je ON je.id = ec.journal_entry_id
      ORDER BY ec.id DESC
    `);
    return rows;
  });

  route('GET', '/api/expense-claims/:id', 'accountant', async req => {
    const { rows: [ec] } = await q(`
      SELECT ec.*, e.employee_no, e.name_ar AS employee_name, p.name_ar AS partner_name,
             b.name_ar AS branch_name, a.name_ar AS expense_account_name, je.entry_no AS journal_entry_no
      FROM expense_claims ec
      LEFT JOIN employees e ON e.id = ec.employee_id
      LEFT JOIN partners p ON p.id = ec.partner_id
      LEFT JOIN branches b ON b.id = ec.branch_id
      LEFT JOIN accounts a ON a.code = ec.expense_account
      LEFT JOIN journal_entries je ON je.id = ec.journal_entry_id
      WHERE ec.id = $1
    `, [req.params.id]);
    if (!ec) throw httpErr(404, 'expense claim not found');
    return ec;
  });

  route('POST', '/api/expense-claims', 'cashier', async req => {
    const b = req.body || {};
    const net = Number(b.net_amount || b.amount || 0);
    if (net <= 0) throw httpErr(400, 'net_amount must be greater than zero');
    if (!b.category || !b.category.trim()) throw httpErr(400, 'category is required');
    if (!b.expense_account) throw httpErr(400, 'expense_account is required');
    const purpose = (b.purpose || b.description || 'مصروف').trim();

    let vatRate = [0, 5, 15].includes(Number(b.vat_rate)) ? Number(b.vat_rate) : 15;
    if (b.tax_code === 'S15') vatRate = 15;
    else if (b.tax_code === 'S05') vatRate = 5;
    else if (b.tax_code === 'Z') vatRate = 0;

    const vatAmt = b.vat_amount !== undefined ? Number(b.vat_amount) : Number((net * (vatRate / 100)).toFixed(2));
    const total = b.total_amount !== undefined ? Number(b.total_amount) : Number((net + vatAmt).toFixed(2));

    const { rows: [{ count }] } = await q('SELECT count(*)::int AS count FROM expense_claims');
    const claimNo = 'EXP-' + today().slice(0, 4) + '-' + String(count + 1).padStart(4, '0');
    const expDate = dateOr(b.expense_date || b.claim_date, today());
    const branchId = b.branch_id ? Number(b.branch_id) : (b.branch ? (await q('SELECT id FROM branches WHERE code=$1', [b.branch])).rows[0]?.id : null);

    const { rows: [claim] } = await q(`
      INSERT INTO expense_claims (
        claim_no, employee_id, partner_id, category, expense_date, branch_id, cost_center,
        expense_account, net_amount, vat_rate, vat_amount, total_amount, payment_method,
        pay_account, purpose, status, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13, 'bank'), $14, $15, coalesce($16, 'submitted'), $17
      ) RETURNING *
    `, [
      claimNo, b.employee_id || null, b.partner_id || null, b.category.trim(), expDate, branchId, b.cost_center || null,
      b.expense_account, net, vatRate, vatAmt, total, b.payment_method, b.pay_account || b.payment_account || null, purpose, b.status, req.user.username
    ]);

    return claim;
  });

  route('PUT', '/api/expense-claims/:id', 'cashier', async req => {
    const b = req.body || {};
    return tx(req.user.username, async client => {
      const { rows: [claim] } = await client.query('SELECT * FROM expense_claims WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!claim) throw httpErr(404, 'expense claim not found');
      if (!['draft', 'submitted'].includes(claim.status)) throw httpErr(422, 'can only edit draft or submitted claims');

      const net = b.net_amount !== undefined ? Number(b.net_amount) : (b.amount !== undefined ? Number(b.amount) : Number(claim.net_amount));
      const vatRate = [0, 5, 15].includes(Number(b.vat_rate)) ? Number(b.vat_rate) : Number(claim.vat_rate);
      const vatAmt = Number((net * (vatRate / 100)).toFixed(2));
      const total = Number((net + vatAmt).toFixed(2));
      const purpose = (b.purpose || b.description || claim.purpose).trim();
      const branchId = b.branch_id ? Number(b.branch_id) : (b.branch ? (await client.query('SELECT id FROM branches WHERE code=$1', [b.branch])).rows[0]?.id : claim.branch_id);

      const { rows: [updated] } = await client.query(`
        UPDATE expense_claims SET
          employee_id = coalesce($1, employee_id),
          partner_id = coalesce($2, partner_id),
          category = coalesce($3, category),
          expense_date = coalesce($4, expense_date),
          branch_id = $5,
          cost_center = coalesce($6, cost_center),
          expense_account = coalesce($7, expense_account),
          net_amount = $8,
          vat_rate = $9,
          vat_amount = $10,
          total_amount = $11,
          payment_method = coalesce($12, payment_method),
          pay_account = coalesce($13, pay_account),
          purpose = $14
        WHERE id = $15 RETURNING *
      `, [
        b.employee_id ? Number(b.employee_id) : null, b.partner_id ? Number(b.partner_id) : null,
        b.category, b.expense_date, branchId, b.cost_center, b.expense_account,
        net, vatRate, vatAmt, total, b.payment_method, b.pay_account || b.payment_account || null,
        purpose, claim.id
      ]);
      return updated;
    });
  });

  route('POST', '/api/expense-claims/:id/approve', 'accountant', async req => {
    return tx(req.user.username, async client => {
      const { rows: [claim] } = await client.query('SELECT * FROM expense_claims WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!claim) throw httpErr(404, 'expense claim not found');
      if (claim.status !== 'submitted' && claim.status !== 'draft') throw httpErr(422, 'can only approve submitted claims');

      await client.query(`
        UPDATE expense_claims SET status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2
      `, [req.user.username, claim.id]);
      return { ok: true, status: 'approved' };
    });
  });

  route('POST', '/api/expense-claims/:id/reject', 'accountant', async req => {
    const { reason } = req.body || {};
    return tx(req.user.username, async client => {
      const { rows: [claim] } = await client.query('SELECT * FROM expense_claims WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!claim) throw httpErr(404, 'expense claim not found');
      if (['posted', 'paid'].includes(claim.status)) throw httpErr(422, 'cannot reject posted or paid claims');

      await client.query(`
        UPDATE expense_claims SET status = 'rejected', rejected_by = $1, rejection_reason = $2 WHERE id = $3
      `, [req.user.username, reason || 'rejected', claim.id]);
      return { ok: true, status: 'rejected' };
    });
  });

  route('POST', '/api/expense-claims/:id/post', 'accountant', async req => {
    const b = req.body || {};
    const payAcc = b.pay_account || b.payment_account || null;
    return tx(req.user.username, async client => {
      const { rows: [claim] } = await client.query('SELECT * FROM expense_claims WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!claim) throw httpErr(404, 'expense claim not found');
      if (claim.status !== 'approved') throw httpErr(422, 'expense claim must be approved before posting');

      if (payAcc) {
        await client.query('UPDATE expense_claims SET pay_account = $1, payment_method = $2 WHERE id = $3', [payAcc, 'bank', claim.id]);
      }

      const { rows: [{ fn_post_expense_claim: entryId }] } = await client.query('SELECT fn_post_expense_claim($1, $2)', [claim.id, req.user.username]);
      return { ok: true, journal_entry_id: entryId };
    });
  });


  // ================= HR REPORTS =================
  const handlePayrollReport = async req => {
    const { period, branch_id } = req.query || {};
    const { rows } = await q(`
      SELECT split_part(pr.period_name, '-', 1)::int AS year,
             split_part(pr.period_name, '-', 2)::int AS month,
             b.name_ar AS branch_name,
             count(*)::int AS runs_count,
             coalesce(sum(pr.employee_count), 0)::int AS total_employees,
             coalesce(sum(pr.total_basic + pr.total_allowances), 0) AS total_gross,
             coalesce(sum(pr.total_deductions), 0) AS total_deductions,
             coalesce(sum(pr.total_net), 0) AS total_net
      FROM payroll_runs pr
      LEFT JOIN branches b ON b.id = pr.branch_id
      WHERE ($1::text IS NULL OR pr.period_name = $1)
        AND ($2::int IS NULL OR pr.branch_id = $2)
      GROUP BY pr.period_name, b.name_ar
      ORDER BY pr.period_name DESC, b.name_ar NULLS FIRST
    `, [period || null, branch_id ? Number(branch_id) : null]);
    return rows;
  };
  route('GET', '/api/reports/payroll', 'accountant', handlePayrollReport);
  route('GET', '/api/reports/hr/payroll-summary', 'accountant', handlePayrollReport);

  const handleCustodiesReport = async () => {
    const { rows } = await q(`
      SELECT e.employee_no, e.name_ar, b.name_ar AS branch_name,
             count(*)::int AS custody_count,
             coalesce(sum(c.amount), 0) AS total_disbursed,
             coalesce(sum(c.settled_amount), 0) AS total_spent,
             coalesce(sum(c.returned_amount), 0) AS total_returned,
             coalesce(sum(c.balance), 0) AS current_balance
      FROM custodies c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN branches b ON b.id = coalesce(c.branch_id, e.branch_id)
      GROUP BY e.employee_no, e.name_ar, b.name_ar
      ORDER BY current_balance DESC, e.name_ar
    `);
    return rows;
  };
  route('GET', '/api/reports/custodies', 'accountant', handleCustodiesReport);
  route('GET', '/api/reports/hr/custody-balances', 'accountant', handleCustodiesReport);

  const handleExpensesReport = async req => {
    const { from, to, branch_id, category } = req.query || {};
    const { rows } = await q(`
      SELECT ec.category, b.name_ar AS branch_name,
             count(*)::int AS claims_count,
             sum(ec.net_amount) AS net_amount,
             sum(ec.vat_amount) AS vat_amount,
             sum(ec.total_amount) AS total_amount
      FROM expense_claims ec
      LEFT JOIN branches b ON b.id = ec.branch_id
      WHERE ($1::date IS NULL OR ec.expense_date >= $1)
        AND ($2::date IS NULL OR ec.expense_date <= $2)
        AND ($3::int IS NULL OR ec.branch_id = $3)
        AND ($4::text IS NULL OR ec.category = $4)
      GROUP BY ec.category, b.name_ar
      ORDER BY total_amount DESC
    `, [from || null, to || null, branch_id ? Number(branch_id) : null, category || null]);
    return rows;
  };
  route('GET', '/api/reports/expenses', 'accountant', handleExpensesReport);
  route('GET', '/api/reports/hr/expenses-by-category', 'accountant', handleExpensesReport);
}
