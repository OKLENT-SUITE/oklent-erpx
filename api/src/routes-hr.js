// OKLENT BUSINESS — HR, Payroll, Custody and Expenses API routes
// Strict accounting integration via post_entry / stored procedures.

export function registerHR({ app, route, auth, q, tx, httpErr, dateOr, today }) {

  // ================= EMPLOYEES =================
  route('GET', '/api/employees', 'viewer', async req => {
    const isRestricted = req.user.role === 'viewer';
    const { rows } = await q(`
      SELECT e.id, e.employee_no, e.name_ar, e.name_en, e.national_id, e.status, e.branch_id,
             b.name_ar AS branch_name, e.department, e.job_title, e.cost_center, e.hire_date,
             e.termination_date, e.phone, e.email, e.payment_method, e.notes, e.created_at,
             ${isRestricted ? 'NULL::numeric' : 'e.basic_salary'} AS basic_salary,
             ${isRestricted ? 'NULL::numeric' : 'e.housing_allowance'} AS housing_allowance,
             ${isRestricted ? 'NULL::numeric' : 'e.transport_allowance'} AS transport_allowance,
             ${isRestricted ? 'NULL::numeric' : 'e.other_allowances'} AS other_allowances,
             ${isRestricted ? 'NULL::numeric' : 'e.gosi_deduction'} AS gosi_deduction,
             ${isRestricted ? 'NULL::numeric' : 'e.other_deductions'} AS other_deductions,
             ${isRestricted ? 'NULL::varchar' : 'e.bank_name'} AS bank_name,
             ${isRestricted ? 'NULL::varchar' : 'e.iban'} AS iban
      FROM employees e
      LEFT JOIN branches b ON b.id = e.branch_id
      ORDER BY e.id DESC
    `);
    return rows;
  });

  route('GET', '/api/employees/:id', 'viewer', async req => {
    const isRestricted = req.user.role === 'viewer';
    const { rows: [e] } = await q(`
      SELECT e.id, e.employee_no, e.name_ar, e.name_en, e.national_id, e.status, e.branch_id,
             b.name_ar AS branch_name, e.department, e.job_title, e.cost_center, e.hire_date,
             e.termination_date, e.phone, e.email, e.payment_method, e.notes, e.attachments, e.created_at,
             ${isRestricted ? 'NULL::numeric' : 'e.basic_salary'} AS basic_salary,
             ${isRestricted ? 'NULL::numeric' : 'e.housing_allowance'} AS housing_allowance,
             ${isRestricted ? 'NULL::numeric' : 'e.transport_allowance'} AS transport_allowance,
             ${isRestricted ? 'NULL::numeric' : 'e.other_allowances'} AS other_allowances,
             ${isRestricted ? 'NULL::numeric' : 'e.gosi_deduction'} AS gosi_deduction,
             ${isRestricted ? 'NULL::numeric' : 'e.other_deductions'} AS other_deductions,
             ${isRestricted ? 'NULL::varchar' : 'e.bank_name'} AS bank_name,
             ${isRestricted ? 'NULL::varchar' : 'e.iban'} AS iban
      FROM employees e
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE e.id = $1
    `, [req.params.id]);
    if (!e) throw httpErr(404, 'employee not found');
    return e;
  });

  route('POST', '/api/employees', 'accountant', async req => {
    const b = req.body || {};
    if (!b.name_ar || !b.name_ar.trim()) throw httpErr(400, 'name_ar is required');
    let empNo = b.employee_no ? String(b.employee_no).trim() : null;
    if (!empNo) {
      const { rows: [{ count }] } = await q('SELECT count(*)::int AS count FROM employees');
      empNo = 'EMP-' + String(count + 1).padStart(4, '0');
    }
    const branchId = b.branch_id ? Number(b.branch_id) : (b.branch ? (await q('SELECT id FROM branches WHERE code=$1', [b.branch])).rows[0]?.id : null);
    const { rows: [emp] } = await q(`
      INSERT INTO employees (
        employee_no, name_ar, name_en, national_id, status, branch_id, department,
        job_title, cost_center, hire_date, termination_date, phone, email,
        basic_salary, housing_allowance, transport_allowance, other_allowances,
        gosi_deduction, other_deductions, bank_name, iban, payment_method, notes, created_by
      ) VALUES (
        $1, $2, $3, $4, coalesce($5, 'active'), $6, $7,
        $8, $9, coalesce($10, current_date), $11, $12, $13,
        coalesce($14, 0), coalesce($15, 0), coalesce($16, 0), coalesce($17, 0),
        coalesce($18, 0), coalesce($19, 0), $20, $21, coalesce($22, 'bank'), $23, $24
      ) RETURNING *
    `, [
      empNo, b.name_ar.trim(), b.name_en || null, b.national_id || null, b.status, branchId, b.department || null,
      b.job_title || null, b.cost_center || null, b.hire_date || null, b.termination_date || null, b.phone || null, b.email || null,
      Number(b.basic_salary || 0), Number(b.housing_allowance || 0), Number(b.transport_allowance || 0), Number(b.other_allowances || 0),
      Number(b.gosi_deduction || 0), Number(b.other_deductions || 0), b.bank_name || null, b.iban || null, b.payment_method, b.notes || null, req.user.username
    ]);
    return emp;
  });

  route('PUT', '/api/employees/:id', 'accountant', async req => {
    const b = req.body || {};
    const branchId = b.branch_id ? Number(b.branch_id) : (b.branch ? (await q('SELECT id FROM branches WHERE code=$1', [b.branch])).rows[0]?.id : null);
    const { rows: [emp] } = await q(`
      UPDATE employees SET
        name_ar = coalesce($1, name_ar),
        name_en = coalesce($2, name_en),
        national_id = coalesce($3, national_id),
        status = coalesce($4, status),
        branch_id = coalesce($5, branch_id),
        department = coalesce($6, department),
        job_title = coalesce($7, job_title),
        cost_center = coalesce($8, cost_center),
        hire_date = coalesce($9, hire_date),
        termination_date = coalesce($10, termination_date),
        phone = coalesce($11, phone),
        email = coalesce($12, email),
        basic_salary = coalesce($13, basic_salary),
        housing_allowance = coalesce($14, housing_allowance),
        transport_allowance = coalesce($15, transport_allowance),
        other_allowances = coalesce($16, other_allowances),
        gosi_deduction = coalesce($17, gosi_deduction),
        other_deductions = coalesce($18, other_deductions),
        bank_name = coalesce($19, bank_name),
        iban = coalesce($20, iban),
        payment_method = coalesce($21, payment_method),
        notes = coalesce($22, notes),
        updated_at = now()
      WHERE id = $23
      RETURNING *
    `, [
      b.name_ar, b.name_en, b.national_id, b.status, branchId, b.department,
      b.job_title, b.cost_center, b.hire_date, b.termination_date, b.phone, b.email,
      b.basic_salary !== undefined ? Number(b.basic_salary) : null,
      b.housing_allowance !== undefined ? Number(b.housing_allowance) : null,
      b.transport_allowance !== undefined ? Number(b.transport_allowance) : null,
      b.other_allowances !== undefined ? Number(b.other_allowances) : null,
      b.gosi_deduction !== undefined ? Number(b.gosi_deduction) : null,
      b.other_deductions !== undefined ? Number(b.other_deductions) : null,
      b.bank_name, b.iban, b.payment_method, b.notes, req.params.id
    ]);
    if (!emp) throw httpErr(404, 'employee not found');
    return emp;
  });

  route('DELETE', '/api/employees/:id', 'accountant', async req => {
    // Triggers will prevent deletion if the employee is referenced in payroll/custody/expenses
    const { rowCount } = await q('DELETE FROM employees WHERE id = $1', [req.params.id]);
    if (!rowCount) throw httpErr(404, 'employee not found');
    return { ok: true };
  });


  // ================= PAYROLL =================
  route('GET', '/api/payroll/runs', 'viewer', async () => {
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

  route('GET', '/api/payroll/runs/:id', 'viewer', async req => {
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
  route('GET', '/api/custodies', 'viewer', async () => {
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

  route('GET', '/api/custodies/:id', 'viewer', async req => {
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
  route('GET', '/api/expense-claims', 'viewer', async () => {
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

  route('GET', '/api/expense-claims/:id', 'viewer', async req => {
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
      SELECT pr.period_name, b.name_ar AS branch_name, pr.status, pr.employee_count,
             pr.total_basic, pr.total_allowances, pr.total_deductions, pr.total_net,
             je.entry_no AS journal_entry_no, pe.entry_no AS payment_entry_no
      FROM payroll_runs pr
      LEFT JOIN branches b ON b.id = pr.branch_id
      LEFT JOIN journal_entries je ON je.id = pr.journal_entry_id
      LEFT JOIN journal_entries pe ON pe.id = pr.payment_entry_id
      WHERE ($1::text IS NULL OR pr.period_name = $1)
        AND ($2::int IS NULL OR pr.branch_id = $2)
      ORDER BY pr.period_name DESC
    `, [period || null, branch_id ? Number(branch_id) : null]);
    return rows;
  };
  route('GET', '/api/reports/payroll', 'viewer', handlePayrollReport);
  route('GET', '/api/reports/hr/payroll-summary', 'viewer', handlePayrollReport);

  const handleCustodiesReport = async () => {
    const { rows } = await q(`
      SELECT c.custody_no, e.name_ar AS employee_name, b.name_ar AS branch_name,
             c.custody_type, c.amount, c.settled_amount, c.returned_amount, c.balance,
             c.status, c.disbursement_date
      FROM custodies c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN branches b ON b.id = c.branch_id
      ORDER BY c.status ASC, c.id DESC
    `);
    return rows;
  };
  route('GET', '/api/reports/custodies', 'viewer', handleCustodiesReport);
  route('GET', '/api/reports/hr/custody-balances', 'viewer', handleCustodiesReport);

  const handleExpensesReport = async req => {
    const { from, to, branch_id, category } = req.query || {};
    const { rows } = await q(`
      SELECT ec.category, b.name_ar AS branch_name, ec.status,
             count(*)::int AS count,
             sum(ec.net_amount) AS total_net,
             sum(ec.vat_amount) AS total_vat,
             sum(ec.total_amount) AS total_amount
      FROM expense_claims ec
      LEFT JOIN branches b ON b.id = ec.branch_id
      WHERE ($1::date IS NULL OR ec.expense_date >= $1)
        AND ($2::date IS NULL OR ec.expense_date <= $2)
        AND ($3::int IS NULL OR ec.branch_id = $3)
        AND ($4::text IS NULL OR ec.category = $4)
      GROUP BY ec.category, b.name_ar, ec.status
      ORDER BY total_amount DESC
    `, [from || null, to || null, branch_id ? Number(branch_id) : null, category || null]);
    return rows;
  };
  route('GET', '/api/reports/expenses', 'viewer', handleExpensesReport);
  route('GET', '/api/reports/hr/expenses-by-category', 'viewer', handleExpensesReport);
}
