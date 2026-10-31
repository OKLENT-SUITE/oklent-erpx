-- 080: Rules Lab. Runs FIXED, hard-coded violation attempts (never user-supplied SQL) inside a sub-transaction
-- that is always rolled back, and reports the error PostgreSQL raised. Used by the web "مختبر القواعد" screen.
CREATE OR REPLACE FUNCTION rules_lab(p_id text) RETURNS TABLE(statement text, sqlstate text, message text, blocked boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pre text := $p$ SELECT post_entry('2026-03-05','lab seed',NULL,'manual',NULL,'lab','[{"account":"1110","debit":100},{"account":"4200","credit":100}]') $p$;
        v_sql text; v_state text; v_msg text;
BEGIN
  CASE p_id
  WHEN 'unbalanced' THEN v_sql := $s$ SELECT post_entry('2026-03-05','lab',NULL,'manual',NULL,'lab','[{"account":"1110","debit":100},{"account":"4200","credit":99}]') $s$;
  WHEN 'one_line' THEN v_sql := $s$ SELECT post_entry('2026-03-05','lab',NULL,'manual',NULL,'lab','[{"account":"1110","debit":100}]') $s$;
  WHEN 'header_account' THEN v_sql := $s$ SELECT post_entry('2026-03-05','lab',NULL,'manual',NULL,'lab','[{"account":"1100","debit":100},{"account":"4200","credit":100}]') $s$;
  WHEN 'no_period' THEN v_sql := $s$ SELECT post_entry('2035-01-05','lab',NULL,'manual',NULL,'lab','[{"account":"1110","debit":100},{"account":"4200","credit":100}]') $s$;
  WHEN 'closed_period' THEN
    v_pre := $p$ SELECT close_period(id,'lab') FROM fiscal_periods WHERE name = '2026-01' $p$;
    v_sql := $s$ SELECT post_entry('2026-01-10','lab',NULL,'manual',NULL,'lab','[{"account":"1110","debit":100},{"account":"4200","credit":100}]') $s$;
  WHEN 'update_line' THEN v_sql := $s$ UPDATE journal_lines SET debit = 1 WHERE id = (SELECT min(id) FROM journal_lines) $s$;
  WHEN 'delete_entry' THEN v_sql := $s$ DELETE FROM journal_entries WHERE id = (SELECT min(id) FROM journal_entries) $s$;
  WHEN 'truncate' THEN v_sql := $s$ TRUNCATE journal_lines CASCADE $s$;
  WHEN 'inject_line' THEN v_sql := $s$ INSERT INTO journal_lines(entry_id,line_no,account_id,currency_code,amount_currency,rate,debit)
        SELECT min(e.id),9,(SELECT id FROM accounts WHERE code='1110'),'SAR',5,1,5 FROM journal_entries e $s$;
  WHEN 'double_reversal' THEN v_sql := $s$ SELECT reverse_entry(e.id,'2026-03-07',NULL,'lab') FROM journal_entries e WHERE e.id = (SELECT min(id) FROM journal_entries) AND reverse_entry(e.id,'2026-03-06',NULL,'lab') > 0 $s$;
  WHEN 'bad_vat' THEN v_sql := $s$ INSERT INTO partners(kind,name_ar,vat_number) VALUES ('customer','x','12345') $s$;
  WHEN 'gapped_icv' THEN v_sql := $s$ INSERT INTO invoices(number,kind,issue_at,supply_date,subtotal,vat_amount,total,uuid,icv,pih,invoice_hash,qr,xml,issued_by)
        VALUES ('X','simplified',now(),current_date,0,0,0,gen_random_uuid(),99,'x','h','q','<x/>','lab') $s$;
  WHEN 'frozen_account' THEN v_sql := $s$ UPDATE accounts SET code = '1119' WHERE code = '1110' $s$;
  WHEN 'close_out_of_order' THEN v_sql := $s$ SELECT close_period(id,'lab') FROM fiscal_periods WHERE name = '2026-03' $s$;
  WHEN 'direct_period_update' THEN v_sql := $s$ UPDATE fiscal_periods SET status = 'closed' WHERE name = '2026-01' $s$;
  WHEN 'missing_rate' THEN v_sql := $s$ SELECT post_entry('2025-12-31','lab',NULL,'manual',NULL,'lab','[{"account":"1110","debit":10,"currency":"USD"},{"account":"4200","credit":37.5}]') $s$;
  ELSE RAISE EXCEPTION 'unknown lab case %', p_id;
  END CASE;
  BEGIN
    PERFORM set_config('erpx.user','lab',true);
    EXECUTE v_pre;
    IF p_id = 'truncate' THEN SET CONSTRAINTS ALL IMMEDIATE; END IF;   -- settle pending deferred checks first
    EXECUTE v_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'LAB-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    v_msg := SQLERRM;
  END;
  statement := btrim(v_sql); sqlstate := v_state; message := v_msg;
  blocked := v_msg <> 'LAB-ACCEPTED';
  RETURN NEXT;
END $$;
COMMENT ON FUNCTION rules_lab IS 'Safe teaching tool: fixed violation attempts, always rolled back.';
GRANT EXECUTE ON FUNCTION rules_lab TO erpx_app;
REVOKE EXECUTE ON FUNCTION rules_lab FROM PUBLIC;

-- numbering helper for master documents created by the app role (leases)
CREATE OR REPLACE FUNCTION next_number_app(p_name text) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT next_number('APP-' || p_name) $$;
REVOKE EXECUTE ON FUNCTION next_number_app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_number_app TO erpx_app;
