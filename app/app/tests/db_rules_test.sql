-- Run: psql -d erpx -f tests/db_rules_test.sql   (as owner; everything is rolled back)
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE results(name text, expected text, got text, pass boolean);
CREATE FUNCTION pg_temp.expect(p_name text, p_code text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m text := 'NO ERROR (statement succeeded)'; failed boolean := false;
BEGIN
  -- the statement MUST raise an error; a statement that succeeds is a FAIL (an empty p_code means "any error"; it is no longer vacuous)
  BEGIN EXECUTE p_sql; EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE'; RAISE EXCEPTION 'ROLLBACKME' USING ERRCODE = 'P9999';
  EXCEPTION WHEN OTHERS THEN IF SQLSTATE <> 'P9999' THEN m := SQLERRM; failed := true; END IF; END;
  INSERT INTO results VALUES (p_name, p_code, left(m,70), failed AND m LIKE p_code || '%');
END $$;

SELECT set_config('erpx.user','tester',true);
SELECT pg_temp.expect('R5 unbalanced entry', 'ERPX-J001', $q$ SELECT post_entry('2026-03-05','x',NULL,'manual',NULL,'t',
  '[{"account":"1110","debit":100},{"account":"4200","credit":99}]') $q$);
SELECT pg_temp.expect('R5 one-line entry', 'ERPX-J002', $q$ SELECT post_entry('2026-03-05','x',NULL,'manual',NULL,'t','[{"account":"1110","debit":100}]') $q$);
SELECT pg_temp.expect('R4 header account', 'ERPX-A001', $q$ SELECT post_entry('2026-03-05','x',NULL,'manual',NULL,'t',
  '[{"account":"1100","debit":100},{"account":"4200","credit":100}]') $q$);
SELECT pg_temp.expect('R2 no period', 'ERPX-P001', $q$ SELECT post_entry('2030-01-05','x',NULL,'manual',NULL,'t',
  '[{"account":"1110","debit":100},{"account":"4200","credit":100}]') $q$);
SELECT pg_temp.expect('C1 missing FX rate', 'ERPX-C001', $q$ SELECT post_entry('2025-12-31','x',NULL,'manual',NULL,'t',
  '[{"account":"1110","debit":100,"currency":"USD"},{"account":"4200","credit":375}]') $q$);

-- valid multi-currency entry: 100 USD @3.75 = 375 SAR
SELECT post_entry('2026-03-05','USD sale',NULL,'manual',NULL,'tester',
  '[{"account":"1110","debit":100,"currency":"USD"},{"account":"4200","credit":375}]') AS ok_multi_currency \gset
SELECT pg_temp.expect('R1 update ledger line', 'ERPX-I001', 'UPDATE journal_lines SET debit = 1 WHERE entry_id = '||:ok_multi_currency);
SELECT pg_temp.expect('R1 delete ledger entry', 'ERPX-I001', 'DELETE FROM journal_entries WHERE id = '||:ok_multi_currency);
SELECT pg_temp.expect('R1 truncate ledger', 'ERPX-I001', 'SET CONSTRAINTS ALL IMMEDIATE; TRUNCATE journal_lines CASCADE');
SELECT pg_temp.expect('R1 update audit log', 'ERPX-I001', 'UPDATE audit_log SET actor = ''x''');
SELECT pg_temp.expect('R4 inject line into old entry', 'ERPX-J001', 'INSERT INTO journal_lines(entry_id,line_no,account_id,currency_code,amount_currency,rate,debit) SELECT '||:ok_multi_currency||',9,id,''SAR'',5,1,5 FROM accounts WHERE code=''1110''');
SELECT reverse_entry(:ok_multi_currency, '2026-03-06', NULL, 'tester') AS rev \gset
SELECT pg_temp.expect('J8 double reversal', 'ERPX-J008', 'SELECT reverse_entry('||:ok_multi_currency||', ''2026-03-07'', NULL, ''t'')');
SELECT pg_temp.expect('J7 reverse a reversal', 'ERPX-J007', 'SELECT reverse_entry('||:rev||', ''2026-03-07'', NULL, ''t'')');
INSERT INTO results SELECT 'Reversal nets the USD sale to zero', '0', sum(debit-credit)::text, sum(debit-credit)=0 FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE je.id IN (:ok_multi_currency, :rev);

SELECT pg_temp.expect('R7 close March while Jan/Feb open', 'ERPX-P003', $q$ SELECT close_period((SELECT id FROM fiscal_periods WHERE name='2026-03'),'t') $q$);
SELECT pg_temp.expect('R7 direct status update', 'ERPX-P007', $q$ UPDATE fiscal_periods SET status='closed' WHERE name='2026-01' $q$);
SELECT close_period(id,'tester') FROM fiscal_periods WHERE name IN ('2026-01') ;
SELECT pg_temp.expect('R2 post into closed period', 'ERPX-P002', $q$ SELECT post_entry('2026-01-10','x',NULL,'manual',NULL,'t',
  '[{"account":"1110","debit":10},{"account":"4200","credit":10}]') $q$);
SELECT pg_temp.expect('P9 reopen without reason', 'ERPX-P009', $q$ SELECT reopen_period((SELECT id FROM fiscal_periods WHERE name='2026-01'),'t','') $q$);
SELECT pg_temp.expect('R6 account type mismatch', '', $q$ INSERT INTO accounts(code,name_ar,name_en,type) VALUES ('6000','x','x','asset') $q$);
SELECT pg_temp.expect('R6 child under postable parent', 'ERPX-A004', $q$ INSERT INTO accounts(code,name_ar,name_en,type,parent_id) SELECT '1111','x','x','asset',id FROM accounts WHERE code='1110' $q$);
SELECT pg_temp.expect('R6 freeze used account', 'ERPX-A005', $q$ UPDATE accounts SET code='1119' WHERE code='1110' $q$);
SELECT pg_temp.expect('R6 delete account', 'ERPX-A006', $q$ DELETE FROM accounts WHERE code='5950' $q$);
SELECT pg_temp.expect('V1 bad VAT number', '', $q$ INSERT INTO partners(kind,name_ar,vat_number) VALUES ('customer','x','123') $q$);
SELECT pg_temp.expect('E1 gapped invoice counter', 'ERPX-E001', $q$ INSERT INTO invoices(number,kind,issue_at,supply_date,subtotal,vat_amount,total,uuid,icv,pih,invoice_hash,qr,xml,issued_by,partner_id)
  VALUES ('X','simplified',now(),current_date,0,0,0,gen_random_uuid(),5,'x','h','q','<x/>','t',NULL) $q$);

-- year-end closing
SELECT post_entry('2026-02-10','sale',NULL,'manual',NULL,'tester','[{"account":"1121","debit":1000},{"account":"4200","credit":1000}]') AS _a \gset
SELECT post_entry('2026-02-11','rent',NULL,'manual',NULL,'tester','[{"account":"5300","debit":300},{"account":"1121","credit":300}]') AS _b \gset
SELECT year_end_close(2026,'tester') AS closing \gset
INSERT INTO results SELECT 'Year close: 3300 receives exactly the income-statement profit', (SELECT sum(CASE WHEN type='revenue' THEN amount ELSE -amount END)::text FROM fn_income_statement('2026-01-01','2026-12-31')),
  (SELECT sum(credit-debit)::text FROM journal_lines WHERE entry_id=:closing AND account_id=(SELECT id FROM accounts WHERE code='3300')),
  (SELECT sum(CASE WHEN type='revenue' THEN amount ELSE -amount END) FROM fn_income_statement('2026-01-01','2026-12-31')) = (SELECT sum(credit-debit) FROM journal_lines WHERE entry_id=:closing AND account_id=(SELECT id FROM accounts WHERE code='3300'));
SELECT pg_temp.expect('Y1 close year twice', 'ERPX-Y001', $q$ SELECT year_end_close(2026,'t') $q$);
INSERT INTO results SELECT 'Trial balance balances', 'dr=cr', sum(closing_debit)||'='||sum(closing_credit), sum(closing_debit)=sum(closing_credit) FROM fn_trial_balance('2026-01-01','2026-12-31');
INSERT INTO results SELECT 'Balance sheet: A = L + E', 'equal', sum(amount) FILTER (WHERE section='asset')||' vs '||sum(amount) FILTER (WHERE section<>'asset'),
  sum(amount) FILTER (WHERE section='asset') = sum(amount) FILTER (WHERE section<>'asset') FROM fn_balance_sheet('2026-12-31');
INSERT INTO results SELECT 'Hash chain verifies', 'true', ok::text, ok FROM verify_chain();

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS status, name, expected, got FROM results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM results;
SELECT count(*) FILTER (WHERE NOT pass) > 0 AS any_fail FROM results \gset
ROLLBACK;
\if :any_fail
  \echo 'db_rules_test: FAILURES PRESENT'
  DO $$ BEGIN RAISE EXCEPTION 'db_rules_test: one or more checks FAILED'; END $$;   -- ON_ERROR_STOP => psql exit code 3
\else
  \echo 'db_rules_test: ALL PASSED'
\endif
