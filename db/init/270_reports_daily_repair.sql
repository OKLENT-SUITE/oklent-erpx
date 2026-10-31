-- Keep report functions available on databases created before all report grants were installed.
-- The frontend does not need source_type, so the daily journal report only depends on core ledger columns.
CREATE OR REPLACE FUNCTION fn_daybook(p_from date, p_to date)
RETURNS TABLE(entry_date date, entry_no text, memo text, source_type text, account_code text, account_name text, debit numeric, credit numeric)
LANGUAGE sql STABLE AS $$
  SELECT je.entry_date, je.entry_no,
         CASE WHEN je.memo LIKE '%???%' THEN
           CASE je.source_type
             WHEN 'payroll' THEN 'استحقاق مسير الرواتب' || coalesce(' لفترة ' || pr.period_name, '')
             WHEN 'payroll_payment' THEN 'صرف مسير الرواتب' || coalesce(' لفترة ' || pr.period_name, '')
             WHEN 'custody' THEN 'صرف عهدة موظف'
             WHEN 'custody_settle' THEN 'تسوية عهدة موظف'
             WHEN 'expense' THEN 'مطالبة مصروفات تشغيلية'
             ELSE 'قيد محاسبي'
           END
         ELSE je.memo END AS memo,
         je.source_type, a.code::text, a.name_ar, jl.debit, jl.credit
  FROM journal_entries je
  JOIN journal_lines jl ON jl.entry_id = je.id
  JOIN accounts a ON a.id = jl.account_id
  LEFT JOIN payroll_runs pr ON pr.id::text = je.source_id AND je.source_type IN ('payroll','payroll_payment')
  WHERE je.entry_date BETWEEN p_from AND p_to
  ORDER BY je.entry_date, je.id, jl.line_no
$$;

DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'fn_trial_balance(date,date)', 'fn_income_statement(date,date)', 'fn_balance_sheet(date)',
    'fn_general_ledger(text,date,date)', 'fn_daybook(date,date)', 'fn_vat_return(date,date)', 'fn_ar_aging(date)'
  ] LOOP
    IF to_regprocedure('public.' || sig) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO erpx_app', sig);
    END IF;
  END LOOP;
END $$;
