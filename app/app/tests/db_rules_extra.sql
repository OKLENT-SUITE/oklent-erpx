-- ACC-01 / T-05 / T-08: extra accounting-integrity tests. Run as the DB owner on a CLEAN or UPGRADED database; everything is rolled back.
--   psql -X -v ON_ERROR_STOP=1 -d erpx -f tests/db_rules_extra.sql        (exit code 3 on any FAIL via the final check)
-- Covers: least-privilege (the API role cannot touch the ledger), inactive account, penny rounding, per-line VAT rounding,
--         credit notes (partial / excess / credit-of-credit), closed period, duplicate invoice number, ICV/PIH chain, hash chain, TB / BS balance.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE results(name text, expected text, got text, pass boolean);
-- expect: the statement must FAIL; p is an ERPX-code prefix OR a SQLSTATE (e.g. 42501). Success is a FAIL of the test (never vacuous).
CREATE FUNCTION pg_temp.expect(p_name text, p text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m text := 'NO ERROR (statement succeeded)'; st text := '';
BEGIN
  BEGIN EXECUTE p_sql; EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE'; RAISE EXCEPTION 'ROLLBACKME' USING ERRCODE = 'P9999';
  EXCEPTION WHEN OTHERS THEN IF SQLSTATE <> 'P9999' THEN m := SQLERRM; st := SQLSTATE; END IF; END;
  INSERT INTO results VALUES (p_name, p, left(st || ' ' || m, 90), p <> '' AND st <> '' AND (m LIKE p || '%' OR st = p));
END $$;
-- ok: the statement must SUCCEED (and is undone afterwards).
CREATE FUNCTION pg_temp.ok(p_name text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m text := 'ok';
BEGIN
  BEGIN EXECUTE p_sql; EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE'; RAISE EXCEPTION 'ROLLBACKME' USING ERRCODE = 'P9999';
  EXCEPTION WHEN OTHERS THEN IF SQLSTATE <> 'P9999' THEN m := SQLSTATE || ' ' || SQLERRM; END IF; END;
  INSERT INTO results VALUES (p_name, 'ok', left(m, 90), m = 'ok');
END $$;
-- mkinv: issue an invoice through the real record_invoice(), continuing the gapless ICV / PIH chain
CREATE FUNCTION pg_temp.mkinv(p_kind text, p_no text, p_lines jsonb, p_related bigint DEFAULT NULL, p_at text DEFAULT '2026-03-10T09:00:00+03:00') RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM lock_invoice_chain();
  RETURN record_invoice(jsonb_build_object('number',p_no,'kind',p_kind,'issue_at',p_at,'supply_date',left(p_at,10),'issued_by','tester','branch','RYD',
    'related_invoice_id',p_related,'reason',CASE WHEN p_kind='credit' THEN 'test' END,'uuid',gen_random_uuid()::text,'icv',coalesce(c.last_icv,0)+1,
    'pih',coalesce(c.last_hash, zatca_genesis_pih()),'invoice_hash',md5(p_no),'qr','q','xml','<x/>'), p_lines);
END $$;
SELECT set_config('erpx.user','tester',true);

-- ===== PRIVILEGE MATRIX: the API role (erpx_app) must not be able to change the ledger, audit log, periods or invoices =====
SELECT pg_temp.expect('PRIV insert journal_entries directly', '42501', $q$ SET LOCAL ROLE erpx_app; INSERT INTO journal_entries(entry_no,entry_date,period_id,total_base,chain_no,prev_hash,row_hash,created_by) VALUES ('X','2026-03-01',1,0,1,'x','x','x') $q$);
SELECT pg_temp.expect('PRIV insert journal_lines directly', '42501', $q$ SET LOCAL ROLE erpx_app; INSERT INTO journal_lines(entry_id,line_no,account_id,currency_code,amount_currency,rate,debit) VALUES (1,1,1,'SAR',1,1,1) $q$);
SELECT pg_temp.expect('PRIV update journal_lines', '42501', $q$ SET LOCAL ROLE erpx_app; UPDATE journal_lines SET debit = debit $q$);
SELECT pg_temp.expect('PRIV delete journal_lines', '42501', $q$ SET LOCAL ROLE erpx_app; DELETE FROM journal_lines $q$);
SELECT pg_temp.expect('PRIV truncate journal_lines', '42501', $q$ SET LOCAL ROLE erpx_app; TRUNCATE journal_lines $q$);
SELECT pg_temp.expect('PRIV update journal_entries', '42501', $q$ SET LOCAL ROLE erpx_app; UPDATE journal_entries SET memo = 'x' $q$);
SELECT pg_temp.expect('PRIV delete journal_entries', '42501', $q$ SET LOCAL ROLE erpx_app; DELETE FROM journal_entries $q$);
SELECT pg_temp.expect('PRIV insert invoices directly', '42501', $q$ SET LOCAL ROLE erpx_app; INSERT INTO invoices(number) VALUES ('X') $q$);
SELECT pg_temp.expect('PRIV update invoices', '42501', $q$ SET LOCAL ROLE erpx_app; UPDATE invoices SET total = 0 $q$);
SELECT pg_temp.expect('PRIV delete invoices', '42501', $q$ SET LOCAL ROLE erpx_app; DELETE FROM invoices $q$);
SELECT pg_temp.expect('PRIV update fiscal_periods directly', '42501', $q$ SET LOCAL ROLE erpx_app; UPDATE fiscal_periods SET status = 'open' $q$);
SELECT pg_temp.expect('PRIV insert audit_log', '42501', $q$ SET LOCAL ROLE erpx_app; INSERT INTO audit_log(actor,table_name,op) VALUES ('x','x','x') $q$);
SELECT pg_temp.expect('PRIV update audit_log', '42501', $q$ SET LOCAL ROLE erpx_app; UPDATE audit_log SET actor = 'x' $q$);
SELECT pg_temp.expect('PRIV delete accounts', '42501', $q$ SET LOCAL ROLE erpx_app; DELETE FROM accounts $q$);
SELECT pg_temp.expect('PRIV disable ledger triggers', '42501', $q$ SET LOCAL ROLE erpx_app; ALTER TABLE journal_lines DISABLE TRIGGER ALL $q$);
SELECT pg_temp.expect('PRIV read users.pw_hash', '42501', $q$ SET LOCAL ROLE erpx_app; SELECT pw_hash FROM users $q$);
SELECT pg_temp.expect('PRIV create_user is owner-only', '42501', $q$ SET LOCAL ROLE erpx_app; SELECT create_user('hacker','Xx-123456789!','admin','x') $q$);
SELECT pg_temp.ok('PRIV the app role CAN post through post_entry()', $q$ SET LOCAL ROLE erpx_app; SELECT post_entry('2026-03-05','via app role',NULL,'manual',NULL,'t','[{"account":"1110","debit":5},{"account":"4200","credit":5}]') $q$);

-- ===== ACCOUNT / ENTRY RULES =====
SELECT pg_temp.expect('A2 inactive account refused', 'ERPX-A002', $q$ UPDATE accounts SET is_active = false WHERE code = '5300';
  SELECT post_entry('2026-03-05','x',NULL,'manual',NULL,'t','[{"account":"5300","debit":10},{"account":"1110","credit":10}]') $q$);
SELECT pg_temp.ok('penny split entry (0.10 = 0.04 + 0.06) is accepted', $q$ SELECT post_entry('2026-03-05','pennies',NULL,'manual',NULL,'t','[{"account":"1110","debit":0.10},{"account":"4200","credit":0.04},{"account":"4200","credit":0.06}]') $q$);
SELECT pg_temp.expect('0.06 imbalance refused (above the 0.05 rounding tolerance)', 'ERPX-J001', $q$ SELECT post_entry('2026-03-05','x',NULL,'manual',NULL,'t','[{"account":"1110","debit":0.10},{"account":"4200","credit":0.04}]') $q$);
SELECT pg_temp.expect('negative debit refused', 'ERPX-J004', $q$ SELECT post_entry('2026-03-05','x',NULL,'manual',NULL,'t','[{"account":"1110","debit":-5},{"account":"4200","credit":-5}]') $q$);
SELECT pg_temp.expect('unknown account refused', 'ERPX-A007', $q$ SELECT post_entry('2026-03-05','x',NULL,'manual',NULL,'t','[{"account":"9999","debit":5},{"account":"4200","credit":5}]') $q$);
-- KNOWN BEHAVIOUR (risk ACC-R1, decision pending): post_entry() absorbs any |difference| <= 0.05 into account 5910 for ANY entry, not only multi-currency ones.
SELECT post_entry('2026-03-05','plug test',NULL,'manual',NULL,'t','[{"account":"1110","debit":0.10},{"account":"4200","credit":0.09}]') AS plug_entry \gset
INSERT INTO results SELECT 'KNOWN: 0.01 single-currency difference is silently plugged to 5910 (entry stays balanced)', 'plug=0.01 & balanced',
  coalesce((SELECT sum(credit)::text FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=:plug_entry AND a.code='5910'),'none'),
  (SELECT sum(credit) FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=:plug_entry AND a.code='5910') = 0.01
  AND (SELECT sum(debit)=sum(credit) FROM journal_lines WHERE entry_id=:plug_entry);

-- ===== INVOICES: VAT rounding, chain, credit notes, duplicates, closed period =====
SELECT pg_temp.mkinv('simplified','TST-0001','[{"description":"A","qty":1,"unit_price":100.00,"discount":0,"tax_code":"S15","net":100.00,"vat":15.00,"revenue_account":"4200"}]') AS inv1 \gset
INSERT INTO results SELECT 'I1 invoice entry balances and AR debit = total', '115.00', (SELECT sum(debit)::text FROM journal_lines WHERE entry_id=(SELECT entry_id FROM invoices WHERE id=:inv1)),
  (SELECT sum(debit)=sum(credit) AND sum(debit)=115.00 FROM journal_lines WHERE entry_id=(SELECT entry_id FROM invoices WHERE id=:inv1));
INSERT INTO results SELECT 'I1 header total = lines net + VAT', '115.00', total::text, total = 115.00 AND subtotal = 100.00 AND vat_amount = 15.00 FROM invoices WHERE id=:inv1;
SELECT pg_temp.expect('I2 VAT truncated instead of rounded (0.05 x 15% must be 0.01)', 'ERPX-E004', $q$ SELECT pg_temp.mkinv('simplified','TST-0002','[{"description":"P","qty":1,"unit_price":0.05,"discount":0,"tax_code":"S15","net":0.05,"vat":0.00,"revenue_account":"4200"}]') $q$);
SELECT pg_temp.mkinv('simplified','TST-0003','[{"description":"P1","qty":1,"unit_price":0.05,"discount":0,"tax_code":"S15","net":0.05,"vat":0.01,"revenue_account":"4200"},{"description":"P2","qty":1,"unit_price":0.05,"discount":0,"tax_code":"S15","net":0.05,"vat":0.01,"revenue_account":"4200"},{"description":"P3","qty":1,"unit_price":0.05,"discount":0,"tax_code":"S15","net":0.05,"vat":0.01,"revenue_account":"4200"}]') AS inv3 \gset
INSERT INTO results SELECT 'I2 per-line VAT rounding: 3 x (0.05 -> 0.01) = 0.03', '0.03', vat_amount::text, vat_amount = 0.03 AND total = 0.18 FROM invoices WHERE id=:inv3;
SELECT pg_temp.expect('I3 net not equal qty x price - discount', 'ERPX-E004', $q$ SELECT pg_temp.mkinv('simplified','TST-0004','[{"description":"X","qty":2,"unit_price":10,"discount":0,"tax_code":"S15","net":19.00,"vat":2.85,"revenue_account":"4200"}]') $q$);
SELECT pg_temp.expect('I4 duplicate invoice number', '23505', $q$ SELECT pg_temp.mkinv('simplified','TST-0001','[{"description":"A","qty":1,"unit_price":1,"discount":0,"tax_code":"S15","net":1,"vat":0.15,"revenue_account":"4200"}]') $q$);
SELECT pg_temp.expect('I5 wrong PIH', 'ERPX-E002', $q$ SELECT record_invoice(jsonb_build_object('number','TST-BADPIH','kind','simplified','issue_at','2026-03-10T09:00:00+03:00','supply_date','2026-03-10','issued_by','t','branch','RYD',
  'uuid',gen_random_uuid()::text,'icv',(SELECT max(icv)+1 FROM invoices),'pih','WRONG','invoice_hash','h','qr','q','xml','<x/>'),
  '[{"description":"A","qty":1,"unit_price":1,"discount":0,"tax_code":"S15","net":1,"vat":0.15,"revenue_account":"4200"}]'::jsonb) $q$);
SELECT pg_temp.expect('I6 credit note larger than the invoice', 'ERPX-E006', format($f$ SELECT pg_temp.mkinv('credit','TST-CN-BIG','[{"description":"A","qty":1,"unit_price":200,"discount":0,"tax_code":"S15","net":200,"vat":30,"revenue_account":"4200"}]', %s) $f$, :inv1));
SELECT pg_temp.mkinv('credit','TST-CN-1','[{"description":"A","qty":1,"unit_price":40,"discount":0,"tax_code":"S15","net":40,"vat":6,"revenue_account":"4200"}]', :inv1) AS cn1 \gset
INSERT INTO results SELECT 'I6 partial credit note reduces outstanding 115.00 -> 69.00', '69.00', fn_invoice_outstanding(:inv1)::text, fn_invoice_outstanding(:inv1) = 69.00;
INSERT INTO results SELECT 'I6 credit note entry reverses sides (debit revenue+VAT, credit AR)', '46.00', (SELECT sum(credit)::text FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=(SELECT entry_id FROM invoices WHERE id=:cn1) AND a.code='1130'),
  (SELECT sum(credit) FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=(SELECT entry_id FROM invoices WHERE id=:cn1) AND a.code='1130') = 46.00;
SELECT pg_temp.expect('I7 credit note of a credit note', 'ERPX-E005', format($f$ SELECT pg_temp.mkinv('credit','TST-CN-CN','[{"description":"A","qty":1,"unit_price":1,"discount":0,"tax_code":"S15","net":1,"vat":0.15,"revenue_account":"4200"}]', %s) $f$, :cn1));
SELECT pg_temp.expect('I8 credit note without a referenced invoice', 'ERPX-E005', $q$ SELECT pg_temp.mkinv('credit','TST-CN-NONE','[{"description":"A","qty":1,"unit_price":1,"discount":0,"tax_code":"S15","net":1,"vat":0.15,"revenue_account":"4200"}]', NULL) $q$);
SELECT close_period(id,'tester') FROM fiscal_periods WHERE name = '2026-01';
SELECT pg_temp.expect('I9 invoice dated in a CLOSED period', 'ERPX-P002', $q$ SELECT pg_temp.mkinv('simplified','TST-CLOSED','[{"description":"A","qty":1,"unit_price":1,"discount":0,"tax_code":"S15","net":1,"vat":0.15,"revenue_account":"4200"}]', NULL, '2026-01-15T09:00:00+03:00') $q$);
SELECT pg_temp.expect('I10 invoice dated with no fiscal period', 'ERPX-P001', $q$ SELECT pg_temp.mkinv('simplified','TST-NOPERIOD','[{"description":"A","qty":1,"unit_price":1,"discount":0,"tax_code":"S15","net":1,"vat":0.15,"revenue_account":"4200"}]', NULL, '2031-01-15T09:00:00+03:00') $q$);

-- ===== GLOBAL INVARIANTS after all the postings above =====
INSERT INTO results SELECT 'every journal entry balances (debit = credit)', '0 unbalanced', count(*) || ' unbalanced', count(*) = 0
  FROM (SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING sum(debit) <> sum(credit)) x;
INSERT INTO results SELECT 'Trial balance balances', 'dr=cr', sum(closing_debit)||'='||sum(closing_credit), sum(closing_debit)=sum(closing_credit) FROM fn_trial_balance('2026-01-01','2026-12-31');
INSERT INTO results SELECT 'Balance sheet A = L + E', 'equal', sum(amount) FILTER (WHERE section='asset')||' vs '||sum(amount) FILTER (WHERE section<>'asset'), sum(amount) FILTER (WHERE section='asset') = sum(amount) FILTER (WHERE section<>'asset') FROM fn_balance_sheet('2026-12-31');
INSERT INTO results SELECT 'Hash chain verifies', 'true', ok::text, ok FROM verify_chain();
INSERT INTO results SELECT 'Invoice ICV is gapless', 'max=count', max(icv)||'='||count(*), max(icv) = count(*) FROM invoices;
INSERT INTO results SELECT 'VAT return: output VAT equals sum of invoice VAT (credit notes negative)', '9.03', (SELECT sum(CASE WHEN kind='credit' THEN -vat_amount ELSE vat_amount END)::text FROM invoices),
  (SELECT sum(CASE WHEN kind='credit' THEN -vat_amount ELSE vat_amount END) FROM invoices) = 15.00 + 0.03 - 6.00;

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS status, name, expected, got FROM results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM results \gset
SELECT :failed::int > 0 AS any_fail \gset
ROLLBACK;
\if :any_fail
  \echo 'db_rules_extra: FAILURES PRESENT'
  DO $$ BEGIN RAISE EXCEPTION 'db_rules_extra: one or more checks FAILED'; END $$;   -- ON_ERROR_STOP => psql exit code 3
\else
  \echo 'db_rules_extra: ALL PASSED'
\endif
