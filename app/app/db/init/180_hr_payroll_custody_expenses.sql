-- 180_hr_payroll_custody_expenses.sql
-- OKLENT BUSINESS — HR, Payroll, Custody and Expenses Module

-- 1. Chart of Accounts Additions for HR & Custody
INSERT INTO accounts(code, name_ar, name_en, type, parent_id, is_postable)
SELECT '1170', 'عهد الموظفين', 'Employee Custodies', 'asset', id, true
FROM accounts WHERE code = '1100'
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts(code, name_ar, name_en, type, parent_id, is_postable)
SELECT '1180', 'سلف الموظفين', 'Employee Advances', 'asset', id, true
FROM accounts WHERE code = '1100'
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts(code, name_ar, name_en, type, parent_id, is_postable)
SELECT '5220', 'بدلات ومزايا الموظفين', 'Employee Allowances', 'expense', id, true
FROM accounts WHERE code = '5000'
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts(code, name_ar, name_en, type, parent_id, is_postable)
SELECT '5230', 'مكافآت وحوافز الموظفين', 'Employee Bonuses', 'expense', id, true
FROM accounts WHERE code = '5000'
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts(code, name_ar, name_en, type, parent_id, is_postable)
SELECT '5240', 'مصروفات سفر وانتقال', 'Travel & Transportation', 'expense', id, true
FROM accounts WHERE code = '5000'
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts(code, name_ar, name_en, type, parent_id, is_postable)
SELECT '5250', 'تدريب وتطوير موظفين', 'Training & Development', 'expense', id, true
FROM accounts WHERE code = '5000'
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts(code, name_ar, name_en, type, parent_id, is_postable)
SELECT '5260', 'مصروفات ضيافة وإعاشة', 'Hospitality & Catering', 'expense', id, true
FROM accounts WHERE code = '5000'
ON CONFLICT (code) DO NOTHING;

-- 2. Employees Table
CREATE TABLE IF NOT EXISTS employees (
  id serial PRIMARY KEY,
  employee_no varchar(32) NOT NULL UNIQUE,
  name_ar varchar(255) NOT NULL,
  name_en varchar(255),
  national_id varchar(32),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'terminated')),
  branch_id int REFERENCES branches(id),
  department varchar(100),
  job_title varchar(100),
  cost_center varchar(50),
  hire_date date NOT NULL DEFAULT current_date,
  termination_date date,
  phone varchar(32),
  email varchar(128),
  basic_salary numeric(12,2) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  housing_allowance numeric(12,2) NOT NULL DEFAULT 0 CHECK (housing_allowance >= 0),
  transport_allowance numeric(12,2) NOT NULL DEFAULT 0 CHECK (transport_allowance >= 0),
  other_allowances numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0),
  gosi_deduction numeric(12,2) NOT NULL DEFAULT 0 CHECK (gosi_deduction >= 0),
  other_deductions numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  bank_name varchar(100),
  iban varchar(34),
  payment_method varchar(20) NOT NULL DEFAULT 'bank' CHECK (payment_method IN ('bank', 'cash')),
  notes text,
  attachments jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);

-- 3. Payroll Runs Table
CREATE TABLE IF NOT EXISTS payroll_runs (
  id serial PRIMARY KEY,
  run_no varchar(32) NOT NULL UNIQUE,
  period_name varchar(20) NOT NULL,
  branch_id int REFERENCES branches(id),
  title_ar varchar(255) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'approved', 'posted', 'paid', 'cancelled')),
  total_basic numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_basic >= 0),
  total_allowances numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_allowances >= 0),
  total_deductions numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_deductions >= 0),
  total_net numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_net >= 0),
  employee_count int NOT NULL DEFAULT 0 CHECK (employee_count >= 0),
  reviewed_by varchar(64),
  reviewed_at timestamptz,
  approved_by varchar(64),
  approved_at timestamptz,
  journal_entry_id bigint REFERENCES journal_entries(id),
  payment_entry_id bigint REFERENCES journal_entries(id),
  paid_at timestamptz,
  paid_by varchar(64),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_period_branch ON payroll_runs (period_name, coalesce(branch_id, 0));
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_runs(status);
CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_runs(period_name);

-- 4. Payroll Items Table
CREATE TABLE IF NOT EXISTS payroll_items (
  id serial PRIMARY KEY,
  payroll_run_id int NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id int NOT NULL REFERENCES employees(id),
  basic_salary numeric(12,2) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  housing_allowance numeric(12,2) NOT NULL DEFAULT 0 CHECK (housing_allowance >= 0),
  transport_allowance numeric(12,2) NOT NULL DEFAULT 0 CHECK (transport_allowance >= 0),
  other_allowances numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0),
  gross_salary numeric(12,2) NOT NULL DEFAULT 0 CHECK (gross_salary >= 0),
  gosi_employee numeric(12,2) NOT NULL DEFAULT 0 CHECK (gosi_employee >= 0),
  advances_deduction numeric(12,2) NOT NULL DEFAULT 0 CHECK (advances_deduction >= 0),
  other_deductions numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  total_deductions numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_deductions >= 0),
  net_salary numeric(12,2) NOT NULL DEFAULT 0 CHECK (net_salary >= 0),
  payment_status varchar(20) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  notes text,
  CONSTRAINT uq_payroll_run_emp UNIQUE (payroll_run_id, employee_id),
  CONSTRAINT chk_payroll_gross CHECK (gross_salary = basic_salary + housing_allowance + transport_allowance + other_allowances),
  CONSTRAINT chk_payroll_deductions CHECK (total_deductions = gosi_employee + advances_deduction + other_deductions),
  CONSTRAINT chk_payroll_net CHECK (net_salary = gross_salary - total_deductions)
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_emp ON payroll_items(employee_id);

-- 5. Custodies Table
CREATE TABLE IF NOT EXISTS custodies (
  id serial PRIMARY KEY,
  custody_no varchar(32) NOT NULL UNIQUE,
  employee_id int NOT NULL REFERENCES employees(id),
  custody_type varchar(20) NOT NULL DEFAULT 'cash' CHECK (custody_type IN ('cash', 'asset')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  settled_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  returned_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (returned_amount >= 0),
  balance numeric(12,2) NOT NULL CHECK (balance >= 0),
  disbursement_date date NOT NULL DEFAULT current_date,
  branch_id int REFERENCES branches(id),
  purpose text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'partially_settled', 'settled', 'closed', 'cancelled')),
  journal_entry_id bigint REFERENCES journal_entries(id),
  attachments jsonb DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  CONSTRAINT chk_custody_balance CHECK (balance = amount - settled_amount - returned_amount)
);

CREATE INDEX IF NOT EXISTS idx_custodies_emp ON custodies(employee_id);
CREATE INDEX IF NOT EXISTS idx_custodies_status ON custodies(status);

-- 6. Custody Settlements Table
CREATE TABLE IF NOT EXISTS custody_settlements (
  id serial PRIMARY KEY,
  settlement_no varchar(32) NOT NULL UNIQUE,
  custody_id int NOT NULL REFERENCES custodies(id),
  settlement_date date NOT NULL DEFAULT current_date,
  expense_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (expense_amount >= 0),
  vat_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  cash_returned numeric(12,2) NOT NULL DEFAULT 0 CHECK (cash_returned >= 0),
  total_settled numeric(12,2) NOT NULL CHECK (total_settled > 0),
  expense_account varchar(10) NOT NULL REFERENCES accounts(code),
  memo text NOT NULL,
  journal_entry_id bigint REFERENCES journal_entries(id),
  attachments jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  CONSTRAINT chk_settlement_sum CHECK (total_settled = expense_amount + vat_amount + cash_returned)
);

CREATE INDEX IF NOT EXISTS idx_settlements_custody ON custody_settlements(custody_id);

-- 7. Expense Claims Table
CREATE TABLE IF NOT EXISTS expense_claims (
  id serial PRIMARY KEY,
  claim_no varchar(32) NOT NULL UNIQUE,
  employee_id int REFERENCES employees(id),
  partner_id int REFERENCES partners(id),
  category varchar(50) NOT NULL,
  expense_date date NOT NULL DEFAULT current_date,
  branch_id int REFERENCES branches(id),
  cost_center varchar(50),
  expense_account varchar(10) NOT NULL REFERENCES accounts(code),
  net_amount numeric(12,2) NOT NULL CHECK (net_amount > 0),
  vat_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate IN (0, 5, 15)),
  vat_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount numeric(12,2) NOT NULL CHECK (total_amount = net_amount + vat_amount),
  payment_method varchar(20) NOT NULL DEFAULT 'bank' CHECK (payment_method IN ('cash', 'bank', 'due')),
  pay_account varchar(10) REFERENCES accounts(code),
  purpose text NOT NULL,
  attachments jsonb DEFAULT '[]'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid', 'posted', 'rejected')),
  reviewed_by varchar(64),
  approved_by varchar(64),
  approved_at timestamptz,
  rejected_by varchar(64),
  rejection_reason text,
  journal_entry_id bigint REFERENCES journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_expenses_emp ON expense_claims(employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expense_claims(status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expense_claims(expense_date);

-- Trigger: Prevent Deleting an Employee with transaction history
CREATE OR REPLACE FUNCTION trg_prevent_employee_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payroll_items WHERE employee_id = OLD.id) OR
     EXISTS (SELECT 1 FROM custodies WHERE employee_id = OLD.id) OR
     EXISTS (SELECT 1 FROM expense_claims WHERE employee_id = OLD.id) THEN
    RAISE EXCEPTION 'ERPX-H005: cannot delete employee % with transaction history; deactivate instead', OLD.employee_no;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_employee_delete ON employees;
CREATE TRIGGER trg_prevent_employee_delete BEFORE DELETE ON employees
FOR EACH ROW EXECUTE FUNCTION trg_prevent_employee_delete();

-- Function 1: Post Payroll Run
CREATE OR REPLACE FUNCTION fn_post_payroll(p_run_id int, p_user text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_run payroll_runs%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_date date;
  v_branch_code text;
  v_entry_id bigint;
  v_total_salaries numeric(14,2) := 0;
  v_total_allowances numeric(14,2) := 0;
  v_total_gosi numeric(14,2) := 0;
  v_total_advances numeric(14,2) := 0;
  v_total_other_ded numeric(14,2) := 0;
  v_total_net numeric(14,2) := 0;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERPX-H001: payroll run % not found', p_run_id;
  END IF;

  IF v_run.status <> 'approved' THEN
    RAISE EXCEPTION 'ERPX-H002: payroll run must be in approved status to post (current: %)', v_run.status;
  END IF;

  IF v_run.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERPX-H003: payroll run % already posted (entry %)', p_run_id, v_run.journal_entry_id;
  END IF;

  IF v_run.branch_id IS NOT NULL THEN
    SELECT code INTO v_branch_code FROM branches WHERE id = v_run.branch_id;
  END IF;

  v_date := (v_run.period_name || '-01')::date + interval '1 month - 1 day';

  SELECT
    coalesce(sum(basic_salary), 0),
    coalesce(sum(housing_allowance + transport_allowance + other_allowances), 0),
    coalesce(sum(gosi_employee), 0),
    coalesce(sum(advances_deduction), 0),
    coalesce(sum(other_deductions), 0),
    coalesce(sum(net_salary), 0)
  INTO
    v_total_salaries, v_total_allowances, v_total_gosi, v_total_advances, v_total_other_ded, v_total_net
  FROM payroll_items
  WHERE payroll_run_id = p_run_id;

  IF v_total_salaries + v_total_allowances = 0 THEN
    RAISE EXCEPTION 'ERPX-H004: payroll run has zero salaries';
  END IF;

  IF v_total_salaries > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', '5200', 'debit', v_total_salaries, 'memo', 'رواتب أساسية: ' || v_run.period_name);
  END IF;

  IF v_total_allowances > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', '5220', 'debit', v_total_allowances, 'memo', 'بدلات ومزايا: ' || v_run.period_name);
  END IF;

  IF v_total_net > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', '2130', 'credit', v_total_net, 'memo', 'صافي رواتب مستحقة: ' || v_run.period_name);
  END IF;

  IF v_total_gosi > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', '2160', 'credit', v_total_gosi, 'memo', 'تأمينات مستقطعة: ' || v_run.period_name);
  END IF;

  IF v_total_advances > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', '1180', 'credit', v_total_advances, 'memo', 'سداد سلف رواتب: ' || v_run.period_name);
  END IF;

  IF v_total_other_ded > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', '5950', 'credit', v_total_other_ded, 'memo', 'استقطاعات وجزاءات: ' || v_run.period_name);
  END IF;

  v_entry_id := post_entry(v_date, 'استحقاق رواتب فترة ' || v_run.period_name, v_branch_code, 'payroll', p_run_id::text, p_user, v_lines);

  UPDATE payroll_runs
  SET status = 'posted', journal_entry_id = v_entry_id
  WHERE id = p_run_id;

  INSERT INTO audit_log(table_name, row_pk, op, actor, old_data, new_data)
  VALUES ('payroll_runs', p_run_id, 'POST', p_user, jsonb_build_object('status', 'approved'), jsonb_build_object('status', 'posted', 'journal_entry_id', v_entry_id));

  RETURN v_entry_id;
END $$;

-- Function 2: Pay Payroll Run
CREATE OR REPLACE FUNCTION fn_pay_payroll(p_run_id int, p_pay_account text, p_pay_date date, p_user text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_run payroll_runs%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_branch_code text;
  v_entry_id bigint;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERPX-H001: payroll run % not found', p_run_id;
  END IF;

  IF v_run.status <> 'posted' THEN
    RAISE EXCEPTION 'ERPX-H006: payroll run must be posted before payment (current: %)', v_run.status;
  END IF;

  IF v_run.payment_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERPX-H007: payroll run % already paid (entry %)', p_run_id, v_run.payment_entry_id;
  END IF;

  IF v_run.branch_id IS NOT NULL THEN
    SELECT code INTO v_branch_code FROM branches WHERE id = v_run.branch_id;
  END IF;

  v_lines := v_lines || jsonb_build_object('account', '2130', 'debit', v_run.total_net, 'memo', 'صرف رواتب: ' || v_run.period_name);
  v_lines := v_lines || jsonb_build_object('account', coalesce(p_pay_account, '1121'), 'credit', v_run.total_net, 'memo', 'صرف رواتب: ' || v_run.period_name);

  v_entry_id := post_entry(coalesce(p_pay_date, current_date), 'صرف رواتب فترة ' || v_run.period_name, v_branch_code, 'payroll_payment', p_run_id::text, p_user, v_lines);

  UPDATE payroll_runs
  SET status = 'paid', payment_entry_id = v_entry_id, paid_at = now(), paid_by = p_user
  WHERE id = p_run_id;

  UPDATE payroll_items
  SET payment_status = 'paid'
  WHERE payroll_run_id = p_run_id;

  INSERT INTO audit_log(table_name, row_pk, op, actor, old_data, new_data)
  VALUES ('payroll_runs', p_run_id, 'PAY', p_user, jsonb_build_object('status', 'posted'), jsonb_build_object('status', 'paid', 'payment_entry_id', v_entry_id));

  RETURN v_entry_id;
END $$;

-- Function 3: Disburse Custody
CREATE OR REPLACE FUNCTION fn_post_custody(p_custody_id int, p_pay_account text, p_user text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cus custodies%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_branch_code text;
  v_entry_id bigint;
  v_emp employees%ROWTYPE;
BEGIN
  SELECT * INTO v_cus FROM custodies WHERE id = p_custody_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERPX-C010: custody % not found', p_custody_id;
  END IF;

  IF v_cus.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERPX-C011: custody % already disbursed (entry %)', p_custody_id, v_cus.journal_entry_id;
  END IF;

  IF v_cus.custody_type = 'cash' THEN
    SELECT * INTO v_emp FROM employees WHERE id = v_cus.employee_id;
    IF v_cus.branch_id IS NOT NULL THEN
      SELECT code INTO v_branch_code FROM branches WHERE id = v_cus.branch_id;
    END IF;

    v_lines := v_lines || jsonb_build_object('account', '1170', 'debit', v_cus.amount, 'memo', 'صرف عهدة: ' || v_emp.name_ar);
    v_lines := v_lines || jsonb_build_object('account', coalesce(p_pay_account, '1110'), 'credit', v_cus.amount, 'memo', 'صرف عهدة: ' || v_emp.name_ar);

    v_entry_id := post_entry(v_cus.disbursement_date, 'صرف عهدة نقدية: ' || v_cus.custody_no || ' — ' || v_emp.name_ar, v_branch_code, 'custody', p_custody_id::text, p_user, v_lines);

    UPDATE custodies
    SET journal_entry_id = v_entry_id, status = 'active'
    WHERE id = p_custody_id;

    INSERT INTO audit_log(table_name, row_pk, op, actor, old_data, new_data)
    VALUES ('custodies', p_custody_id, 'DISBURSE', p_user, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'active', 'journal_entry_id', v_entry_id));
  END IF;

  RETURN v_entry_id;
END $$;

-- Function 4: Settle Custody
CREATE OR REPLACE FUNCTION fn_settle_custody(p_settlement_id int, p_user text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_stl custody_settlements%ROWTYPE;
  v_cus custodies%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_branch_code text;
  v_entry_id bigint;
  v_emp employees%ROWTYPE;
  v_new_settled numeric(12,2);
  v_new_returned numeric(12,2);
  v_new_balance numeric(12,2);
  v_new_status varchar(20);
BEGIN
  SELECT * INTO v_stl FROM custody_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERPX-C012: settlement % not found', p_settlement_id;
  END IF;

  IF v_stl.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERPX-C013: settlement % already posted', p_settlement_id;
  END IF;

  SELECT * INTO v_cus FROM custodies WHERE id = v_stl.custody_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERPX-C010: custody % not found', v_stl.custody_id;
  END IF;

  IF v_stl.total_settled > v_cus.balance THEN
    RAISE EXCEPTION 'ERPX-C014: settlement amount (%) exceeds open custody balance (%)', v_stl.total_settled, v_cus.balance;
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = v_cus.employee_id;
  IF v_cus.branch_id IS NOT NULL THEN
    SELECT code INTO v_branch_code FROM branches WHERE id = v_cus.branch_id;
  END IF;

  IF v_stl.expense_amount > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', v_stl.expense_account, 'debit', v_stl.expense_amount, 'memo', v_stl.memo);
  END IF;

  IF v_stl.vat_amount > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', '1150', 'debit', v_stl.vat_amount, 'memo', 'ضريبة مدخلات عهدة: ' || v_cus.custody_no);
  END IF;

  IF v_stl.cash_returned > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', '1110', 'debit', v_stl.cash_returned, 'memo', 'استرداد متبقي عهدة: ' || v_cus.custody_no);
  END IF;

  v_lines := v_lines || jsonb_build_object('account', '1170', 'credit', v_stl.total_settled, 'memo', 'تسوية عهدة: ' || v_cus.custody_no || ' — ' || v_emp.name_ar);

  v_entry_id := post_entry(v_stl.settlement_date, 'تسوية عهدة: ' || v_cus.custody_no || ' — ' || v_stl.memo, v_branch_code, 'custody_settle', p_settlement_id::text, p_user, v_lines);

  v_new_settled := v_cus.settled_amount + v_stl.expense_amount + v_stl.vat_amount;
  v_new_returned := v_cus.returned_amount + v_stl.cash_returned;
  v_new_balance := v_cus.amount - v_new_settled - v_new_returned;

  IF v_new_balance = 0 THEN
    v_new_status := 'closed';
  ELSE
    v_new_status := 'partially_settled';
  END IF;

  UPDATE custodies
  SET settled_amount = v_new_settled, returned_amount = v_new_returned, balance = v_new_balance, status = v_new_status
  WHERE id = v_cus.id;

  UPDATE custody_settlements
  SET journal_entry_id = v_entry_id
  WHERE id = p_settlement_id;

  INSERT INTO audit_log(table_name, row_pk, op, actor, old_data, new_data)
  VALUES ('custody_settlements', p_settlement_id, 'POST', p_user, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'posted', 'journal_entry_id', v_entry_id, 'custody_balance', v_new_balance));

  RETURN v_entry_id;
END $$;

-- Function 5: Post Expense Claim
CREATE OR REPLACE FUNCTION fn_post_expense_claim(p_claim_id int, p_user text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_exp expense_claims%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_branch_code text;
  v_entry_id bigint;
  v_pay_acc text;
  v_target_status text := 'posted';
BEGIN
  SELECT * INTO v_exp FROM expense_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERPX-X001: expense claim % not found', p_claim_id;
  END IF;

  IF v_exp.status <> 'approved' THEN
    RAISE EXCEPTION 'ERPX-X002: expense claim must be approved before posting (current: %)', v_exp.status;
  END IF;

  IF v_exp.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'ERPX-X003: expense claim % already posted (entry %)', p_claim_id, v_exp.journal_entry_id;
  END IF;

  IF v_exp.branch_id IS NOT NULL THEN
    SELECT code INTO v_branch_code FROM branches WHERE id = v_exp.branch_id;
  END IF;

  IF v_exp.payment_method = 'cash' THEN
    v_pay_acc := coalesce(v_exp.pay_account, '1110');
    v_target_status := 'paid';
  ELSIF v_exp.payment_method = 'bank' THEN
    v_pay_acc := coalesce(v_exp.pay_account, '1121');
    v_target_status := 'paid';
  ELSE
    v_pay_acc := coalesce(v_exp.pay_account, '2120');
    v_target_status := 'posted';
  END IF;

  v_lines := v_lines || jsonb_build_object('account', v_exp.expense_account, 'debit', v_exp.net_amount, 'memo', v_exp.purpose);

  IF v_exp.vat_amount > 0 THEN
    v_lines := v_lines || jsonb_build_object('account', '1150', 'debit', v_exp.vat_amount, 'memo', 'ضريبة مدخلات: ' || v_exp.claim_no);
  END IF;

  v_lines := v_lines || jsonb_build_object('account', v_pay_acc, 'credit', v_exp.total_amount, 'memo', 'مصروف ' || v_exp.claim_no || ': ' || v_exp.purpose);

  v_entry_id := post_entry(v_exp.expense_date, 'مصروف: ' || v_exp.claim_no || ' — ' || v_exp.purpose, v_branch_code, 'expense', p_claim_id::text, p_user, v_lines);

  UPDATE expense_claims
  SET status = v_target_status, journal_entry_id = v_entry_id
  WHERE id = p_claim_id;

  INSERT INTO audit_log(table_name, row_pk, op, actor, old_data, new_data)
  VALUES ('expense_claims', p_claim_id, 'POST', p_user, jsonb_build_object('status', 'approved'), jsonb_build_object('status', v_target_status, 'journal_entry_id', v_entry_id));

  RETURN v_entry_id;
END $$;
