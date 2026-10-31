-- 050: reports computed in the database (aggregation at DB level, not in app memory)
CREATE FUNCTION fn_trial_balance(p_from date, p_to date)
RETURNS TABLE(code text, name_ar text, name_en text, type account_type, opening numeric, period_debit numeric, period_credit numeric, closing_debit numeric, closing_credit numeric)
LANGUAGE sql STABLE AS $$
  WITH m AS (
    SELECT jl.account_id,
      sum(CASE WHEN je.entry_date < p_from THEN jl.debit - jl.credit ELSE 0 END) AS opening,
      sum(CASE WHEN je.entry_date >= p_from THEN jl.debit ELSE 0 END) AS dr,
      sum(CASE WHEN je.entry_date >= p_from THEN jl.credit ELSE 0 END) AS cr
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.entry_date <= p_to GROUP BY jl.account_id)
  SELECT a.code::text, a.name_ar, a.name_en, a.type, m.opening, m.dr, m.cr,
         CASE WHEN m.opening + m.dr - m.cr > 0 THEN m.opening + m.dr - m.cr ELSE 0 END,
         CASE WHEN m.opening + m.dr - m.cr < 0 THEN m.cr - m.dr - m.opening ELSE 0 END
  FROM m JOIN accounts a ON a.id = m.account_id ORDER BY a.code $$;

CREATE FUNCTION fn_income_statement(p_from date, p_to date)
RETURNS TABLE(code text, name_ar text, name_en text, type account_type, amount numeric) LANGUAGE sql STABLE AS $$
  SELECT a.code::text, a.name_ar, a.name_en, a.type,
         CASE WHEN a.type = 'revenue' THEN sum(jl.credit - jl.debit) ELSE sum(jl.debit - jl.credit) END
  FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
  WHERE a.type IN ('revenue','expense') AND je.entry_date BETWEEN p_from AND p_to AND je.source_type <> 'year_close'
  GROUP BY a.code, a.name_ar, a.name_en, a.type HAVING sum(jl.debit - jl.credit) <> 0 ORDER BY a.code $$;

CREATE FUNCTION fn_balance_sheet(p_as_of date)
RETURNS TABLE(section text, code text, name_ar text, name_en text, amount numeric) LANGUAGE sql STABLE AS $$
  WITH b AS (
    SELECT a.type, a.code, a.name_ar, a.name_en, sum(jl.debit - jl.credit) bal
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
    WHERE je.entry_date <= p_as_of GROUP BY a.type, a.code, a.name_ar, a.name_en)
  SELECT type::text, code::text, name_ar, name_en, CASE WHEN type = 'asset' THEN bal ELSE -bal END FROM b WHERE type IN ('asset','liability','equity') AND bal <> 0
  UNION ALL   -- un-closed profit/loss of the open year appears inside equity
  SELECT 'equity','3999','أرباح (خسائر) الفترة الحالية','Current-period earnings', -sum(bal) FROM b WHERE type IN ('revenue','expense') HAVING sum(bal) <> 0
  ORDER BY 1, 2 $$;

CREATE FUNCTION fn_general_ledger(p_code text, p_from date, p_to date)
RETURNS TABLE(entry_date date, entry_no text, memo text, partner text, debit numeric, credit numeric, balance numeric) LANGUAGE sql STABLE AS $$
  WITH acc AS (SELECT id FROM accounts WHERE code = p_code),
  op AS (SELECT coalesce(sum(jl.debit - jl.credit),0) o FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id = (SELECT id FROM acc) AND je.entry_date < p_from),
  mv AS (SELECT je.entry_date, je.entry_no, coalesce(jl.memo, je.memo) memo, p.name_ar partner, jl.debit, jl.credit, je.id, jl.line_no
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id LEFT JOIN partners p ON p.id = jl.partner_id
         WHERE jl.account_id = (SELECT id FROM acc) AND je.entry_date BETWEEN p_from AND p_to)
  SELECT p_from, 'OPENING', 'رصيد افتتاحي / Opening balance', NULL::text, 0::numeric, 0::numeric, (SELECT o FROM op)
  UNION ALL
  SELECT entry_date, entry_no, memo, partner, debit, credit, (SELECT o FROM op) + sum(debit - credit) OVER (ORDER BY entry_date, id, line_no) FROM mv $$;

CREATE FUNCTION fn_daybook(p_from date, p_to date)
RETURNS TABLE(entry_date date, entry_no text, memo text, source_type text, account_code text, account_name text, debit numeric, credit numeric) LANGUAGE sql STABLE AS $$
  SELECT je.entry_date, je.entry_no, je.memo, je.source_type, a.code::text, a.name_ar, jl.debit, jl.credit
  FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id JOIN accounts a ON a.id = jl.account_id
  WHERE je.entry_date BETWEEN p_from AND p_to ORDER BY je.entry_date, je.id, jl.line_no $$;

-- Saudi VAT return summary (output VAT from issued invoices; credit notes subtract; input VAT from account 1150)
CREATE FUNCTION fn_vat_return(p_from date, p_to date)
RETURNS TABLE(box text, label_ar text, label_en text, net numeric, vat numeric) LANGUAGE sql STABLE AS $$
  WITH s AS (
    SELECT t.category, CASE WHEN i.kind = 'credit' THEN -1 ELSE 1 END sg, il.net, il.vat
    FROM invoices i JOIN invoice_lines il ON il.invoice_id = i.id JOIN tax_codes t ON t.code = il.tax_code
    WHERE (i.issue_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN p_from AND p_to)
  SELECT '1', 'المبيعات الخاضعة للنسبة الأساسية', 'Standard-rated sales', coalesce(sum(sg*net) FILTER (WHERE category='S'),0), coalesce(sum(sg*vat) FILTER (WHERE category='S'),0) FROM s
  UNION ALL SELECT '4', 'المبيعات الخاضعة لنسبة الصفر', 'Zero-rated sales', coalesce(sum(sg*net) FILTER (WHERE category='Z'),0), 0 FROM s
  UNION ALL SELECT '6', 'المبيعات المعفاة (منها الإيجار السكني)', 'Exempt sales (incl. residential rent)', coalesce(sum(sg*net) FILTER (WHERE category='E'),0), 0 FROM s
  UNION ALL SELECT '9', 'المشتريات الخاضعة للنسبة الأساسية (ضريبة المدخلات)', 'Input VAT (account 1150)', 0,
     coalesce((SELECT sum(jl.debit - jl.credit) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
               JOIN accounts a ON a.id = jl.account_id WHERE a.code = '1150' AND je.entry_date BETWEEN p_from AND p_to),0)
  UNION ALL SELECT '15', 'صافي الضريبة المستحقة (مخرجات − مدخلات)', 'Net VAT due (output − input)', 0,
     coalesce((SELECT sum(sg*vat) FROM s),0) - coalesce((SELECT sum(jl.debit - jl.credit) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
               JOIN accounts a ON a.id = jl.account_id WHERE a.code = '1150' AND je.entry_date BETWEEN p_from AND p_to),0) $$;

CREATE FUNCTION fn_ar_aging(p_as_of date)
RETURNS TABLE(partner_id int, partner text, invoice_no text, due_date date, outstanding numeric, bucket text) LANGUAGE sql STABLE AS $$
  SELECT i.partner_id, coalesce(p.name_ar,'—'), i.number, coalesce(i.due_date, (i.issue_at)::date), fn_invoice_outstanding(i.id),
         CASE WHEN p_as_of - coalesce(i.due_date,(i.issue_at)::date) <= 0 THEN 'غير مستحق'
              WHEN p_as_of - coalesce(i.due_date,(i.issue_at)::date) <= 30 THEN '1-30'
              WHEN p_as_of - coalesce(i.due_date,(i.issue_at)::date) <= 60 THEN '31-60'
              WHEN p_as_of - coalesce(i.due_date,(i.issue_at)::date) <= 90 THEN '61-90' ELSE '90+' END
  FROM invoices i LEFT JOIN partners p ON p.id = i.partner_id
  WHERE i.kind <> 'credit' AND (i.issue_at AT TIME ZONE 'Asia/Riyadh')::date <= p_as_of AND fn_invoice_outstanding(i.id) > 0
  ORDER BY 2, 4 $$;
