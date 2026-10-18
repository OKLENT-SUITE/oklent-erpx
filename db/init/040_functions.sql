-- 040: the ONLY doors into the ledger. SECURITY DEFINER functions owned by the schema owner;
-- the application role has SELECT on ledger tables but no INSERT/UPDATE/DELETE (see 070).
CREATE FUNCTION fn_rate(p_cur char, p_date date) RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE r numeric; b char(3);
BEGIN
  SELECT code INTO b FROM currencies WHERE is_base;
  IF p_cur = b THEN RETURN 1; END IF;
  SELECT rate INTO r FROM exchange_rates WHERE currency_code = p_cur AND rate_date <= p_date ORDER BY rate_date DESC LIMIT 1;
  IF r IS NULL THEN RAISE EXCEPTION 'ERPX-C001: no exchange rate for % on or before %', p_cur, p_date; END IF;
  RETURN r;
END $$;

CREATE FUNCTION post_entry(p_date date, p_memo text, p_branch text, p_source_type text, p_source_id text,
                           p_user text, p_lines jsonb, p_reversal_of bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_base char(3); v_branch int; v_rows jsonb := '[]'; l jsonb; ord int; v_acc int; v_cur char(3); v_rate numeric;
        dr numeric; cr numeric; v_amt numeric; v_d numeric := 0; v_c numeric := 0; v_diff numeric; v_id bigint; v_no text;
BEGIN
  PERFORM set_config('erpx.user', coalesce(p_user,'system'), true);
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'ERPX-J002: an entry needs at least 2 lines'; END IF;
  IF length(btrim(coalesce(p_memo,''))) = 0 THEN RAISE EXCEPTION 'ERPX-J005: memo is required'; END IF;
  SELECT code INTO v_base FROM currencies WHERE is_base;
  IF p_branch IS NOT NULL THEN
    SELECT id INTO v_branch FROM branches WHERE code = p_branch AND is_active;
    IF v_branch IS NULL THEN RAISE EXCEPTION 'ERPX-B001: unknown branch %', p_branch; END IF; END IF;
  FOR l, ord IN SELECT value, ordinality FROM jsonb_array_elements(p_lines) WITH ORDINALITY LOOP
    SELECT id INTO v_acc FROM accounts WHERE code = l->>'account';
    IF v_acc IS NULL THEN RAISE EXCEPTION 'ERPX-A007: unknown account %', l->>'account'; END IF;
    v_cur := upper(coalesce(nullif(l->>'currency',''), v_base));
    IF NOT EXISTS (SELECT 1 FROM currencies WHERE code = v_cur) THEN RAISE EXCEPTION 'ERPX-C005: unknown currency %', v_cur; END IF;
    v_rate := coalesce(nullif(l->>'rate','')::numeric, fn_rate(v_cur, p_date));
    dr := coalesce(nullif(l->>'debit','')::numeric,0); cr := coalesce(nullif(l->>'credit','')::numeric,0);
    IF dr < 0 OR cr < 0 OR (dr > 0 AND cr > 0) OR (dr = 0 AND cr = 0) THEN
      RAISE EXCEPTION 'ERPX-J004: line % must have exactly one positive side', ord; END IF;
    v_amt := round(greatest(dr,cr) * v_rate, 2);
    IF v_amt = 0 THEN RAISE EXCEPTION 'ERPX-J004: line % rounds to zero in base currency', ord; END IF;
    IF dr > 0 THEN v_d := v_d + v_amt; ELSE v_c := v_c + v_amt; END IF;
    v_rows := v_rows || jsonb_build_object('account_id', v_acc, 'partner_id', nullif(l->>'partner_id','')::int, 'memo', l->>'memo',
        'currency_code', v_cur, 'amount_currency', dr - cr, 'rate', v_rate, 'debit', CASE WHEN dr>0 THEN v_amt ELSE 0 END,
        'credit', CASE WHEN cr>0 THEN v_amt ELSE 0 END);
  END LOOP;
  v_diff := v_d - v_c;                              -- tiny multi-currency rounding differences (<= 0.05) go to 5910
  IF v_diff <> 0 AND abs(v_diff) <= 0.05 THEN
    SELECT id INTO v_acc FROM accounts WHERE code = '5910';
    v_rows := v_rows || jsonb_build_object('account_id', v_acc, 'currency_code', v_base, 'amount_currency', -v_diff, 'rate', 1,
        'debit', CASE WHEN v_diff<0 THEN -v_diff ELSE 0 END, 'credit', CASE WHEN v_diff>0 THEN v_diff ELSE 0 END, 'memo','rounding');
    IF v_diff > 0 THEN v_c := v_c + v_diff; ELSE v_d := v_d - v_diff; END IF;
  END IF;
  v_no := 'JE-' || to_char(p_date,'YYYY') || '-' || lpad(next_number('JE-' || to_char(p_date,'YYYY'))::text, 6, '0');
  INSERT INTO journal_entries(entry_no,entry_date,period_id,branch_id,memo,source_type,source_id,reversal_of,total_base,chain_no,prev_hash,row_hash,created_by)
  VALUES (v_no,p_date,0,v_branch,p_memo,coalesce(p_source_type,'manual'),p_source_id,p_reversal_of,v_d,0,'','',coalesce(p_user,'system'))
  RETURNING id INTO v_id;     -- (period_id placeholder is overwritten by trigger R2)
  INSERT INTO journal_lines(entry_id,line_no,account_id,partner_id,branch_id,memo,currency_code,amount_currency,rate,debit,credit)
  SELECT v_id, (row_number() OVER ())::smallint, r.account_id, r.partner_id, v_branch, r.memo, r.currency_code, r.amount_currency, r.rate, r.debit, r.credit
  FROM jsonb_to_recordset(v_rows) AS r(account_id int, partner_id int, memo text, currency_code char(3), amount_currency numeric, rate numeric, debit numeric, credit numeric);
  RETURN v_id;
END $$;
COMMENT ON FUNCTION post_entry IS 'Single entry point to the ledger. Resolves rates, rounds, adds rounding line, inserts header+lines; triggers R2-R5 validate.';

CREATE FUNCTION reverse_entry(p_entry_id bigint, p_date date, p_memo text, p_user text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e journal_entries; v_lines jsonb;
BEGIN
  SELECT * INTO e FROM journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-J006: entry % not found', p_entry_id; END IF;
  IF e.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'ERPX-J007: a reversal entry cannot itself be reversed'; END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE reversal_of = p_entry_id) THEN RAISE EXCEPTION 'ERPX-J008: entry already reversed'; END IF;
  SELECT jsonb_agg(jsonb_build_object('account', a.code, 'partner_id', jl.partner_id, 'currency', jl.currency_code, 'rate', jl.rate,
           'debit', CASE WHEN jl.credit > 0 THEN abs(jl.amount_currency) ELSE 0 END,
           'credit', CASE WHEN jl.debit > 0 THEN abs(jl.amount_currency) ELSE 0 END, 'memo', jl.memo) ORDER BY jl.line_no)
    INTO v_lines FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = p_entry_id;
  RETURN post_entry(coalesce(p_date, current_date), coalesce(nullif(p_memo,''), 'Reversal of ' || e.entry_no),
                    (SELECT code FROM branches WHERE id = e.branch_id), e.source_type, e.source_id, p_user, v_lines, p_entry_id);
END $$;

CREATE FUNCTION close_period(p_id int, p_user text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('erpx.user', p_user, true); PERFORM set_config('erpx.allow_period_change','on',true);
  UPDATE fiscal_periods SET status='closed', closed_at=now(), closed_by=p_user WHERE id=p_id AND status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-P008: period % is not open', p_id; END IF;
END $$;
CREATE FUNCTION reopen_period(p_id int, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF length(btrim(coalesce(p_reason,''))) < 5 THEN RAISE EXCEPTION 'ERPX-P009: a written reason (>=5 chars) is required to reopen a period'; END IF;
  PERFORM set_config('erpx.user', p_user, true); PERFORM set_config('erpx.allow_period_change','on',true);
  UPDATE fiscal_periods SET status='open', closed_at=NULL, closed_by=NULL WHERE id=p_id AND status='closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-P008: period % is not closed', p_id; END IF;
  INSERT INTO audit_log(actor,table_name,op,row_pk,new_data) VALUES (p_user,'fiscal_periods','REOPEN',p_id::text,jsonb_build_object('reason',p_reason));
END $$;
CREATE FUNCTION lock_period(p_id int, p_user text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('erpx.user', p_user, true); PERFORM set_config('erpx.allow_period_change','on',true);
  UPDATE fiscal_periods SET status='locked' WHERE id=p_id AND status='closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-P008: only a closed period can be locked'; END IF;
END $$;

CREATE FUNCTION year_end_close(p_year int, p_user text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_start date; v_end date; v_lines jsonb; v_net numeric;
BEGIN
  SELECT min(start_date), max(end_date) INTO v_start, v_end FROM fiscal_periods WHERE fiscal_year = p_year;
  IF v_start IS NULL THEN RAISE EXCEPTION 'ERPX-Y003: no periods for year %', p_year; END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_type='year_close' AND source_id = p_year::text) THEN
    RAISE EXCEPTION 'ERPX-Y001: year % already closed', p_year; END IF;
  SELECT jsonb_agg(jsonb_build_object('account', code, 'debit', CASE WHEN b<0 THEN -b ELSE 0 END, 'credit', CASE WHEN b>0 THEN b ELSE 0 END)), sum(b)
    INTO v_lines, v_net
  FROM (SELECT a.code, sum(jl.debit - jl.credit) b FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE a.type IN ('revenue','expense') AND je.entry_date BETWEEN v_start AND v_end
        GROUP BY a.code HAVING sum(jl.debit - jl.credit) <> 0) s;
  IF v_lines IS NULL THEN RAISE EXCEPTION 'ERPX-Y002: nothing to close for %', p_year; END IF;
  IF v_net > 0 THEN v_lines := v_lines || jsonb_build_object('account','3300','debit',v_net,'credit',0);          -- net loss
  ELSIF v_net < 0 THEN v_lines := v_lines || jsonb_build_object('account','3300','debit',0,'credit',-v_net); END IF; -- net profit
  RETURN post_entry(v_end, 'Year-end closing ' || p_year, NULL, 'year_close', p_year::text, p_user, v_lines);
END $$;

CREATE FUNCTION create_user(p_username text, p_password text, p_role text, p_full_name text) RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO users(username,pw_hash,role,full_name) VALUES (p_username, crypt(p_password, gen_salt('bf',10)), p_role, p_full_name) RETURNING id $$;
CREATE FUNCTION login_user(p_username text, p_password text) RETURNS TABLE(id int, username text, role text, full_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id,u.username,u.role,u.full_name FROM users u WHERE u.username=p_username AND u.is_active AND u.pw_hash = crypt(p_password,u.pw_hash) $$;

-- ---------- property ----------
CREATE FUNCTION generate_rent_schedule(p_lease_id int, p_user text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l leases; months int; step int; n int; total numeric; per numeric; i int;
BEGIN
  PERFORM set_config('erpx.user', p_user, true);
  SELECT * INTO l FROM leases WHERE id = p_lease_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-L002: lease not found'; END IF;
  IF EXISTS (SELECT 1 FROM rent_schedule WHERE lease_id = p_lease_id) THEN RAISE EXCEPTION 'ERPX-L003: schedule already generated'; END IF;
  months := (extract(year FROM age(l.end_date + 1, l.start_date)) * 12 + extract(month FROM age(l.end_date + 1, l.start_date)))::int;
  IF months < 1 THEN RAISE EXCEPTION 'ERPX-L004: lease shorter than one month'; END IF;
  step := CASE l.payment_freq WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'semiannual' THEN 6 ELSE 12 END;
  n := ceil(months::numeric / step); total := round(l.annual_rent * months / 12, 2); per := round(total / n, 2);
  FOR i IN 1..n LOOP
    INSERT INTO rent_schedule(lease_id,seq,due_date,amount,vat_rate)
    VALUES (p_lease_id, i, (l.start_date + make_interval(months => (i-1)*step))::date,
            CASE WHEN i = n THEN total - per*(n-1) ELSE per END, CASE WHEN l.vat_applicable THEN 15 ELSE 0 END);
  END LOOP;
  RETURN n;
END $$;

-- ---------- e-invoicing ----------
CREATE FUNCTION lock_invoice_chain() RETURNS TABLE(last_icv bigint, last_hash text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7002);
  RETURN QUERY SELECT coalesce(max(i.icv),0)::bigint,
    coalesce((SELECT invoice_hash FROM invoices ORDER BY icv DESC LIMIT 1), zatca_genesis_pih()) FROM invoices i;
END $$;
CREATE FUNCTION next_invoice_no(p_kind text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (CASE p_kind WHEN 'credit' THEN 'CN' WHEN 'debit' THEN 'DN' ELSE 'INV' END) || '-' || to_char(now() AT TIME ZONE 'Asia/Riyadh','YYYY') || '-' ||
         lpad(next_number((CASE p_kind WHEN 'credit' THEN 'CN' WHEN 'debit' THEN 'DN' ELSE 'INV' END) || to_char(now() AT TIME ZONE 'Asia/Riyadh','YYYY'))::text, 6, '0') $$;

CREATE FUNCTION fn_invoice_outstanding(p_id bigint) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT i.total - coalesce((SELECT sum(amount) FROM invoice_payments WHERE invoice_id = i.id),0)
                 - coalesce((SELECT sum(total) FROM invoices c WHERE c.related_invoice_id = i.id AND c.kind = 'credit'),0)
  FROM invoices i WHERE i.id = p_id AND i.kind <> 'credit' $$;

CREATE FUNCTION record_invoice(p_inv jsonb, p_lines jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint; v_entry bigint; v_kind text := p_inv->>'kind'; v_sub numeric; v_vat numeric; v_tot numeric; v_date date;
        v_user text := p_inv->>'issued_by'; v_je jsonb; rel invoices; v_partner int := nullif(p_inv->>'partner_id','')::int;
BEGIN
  PERFORM set_config('erpx.user', v_user, true);
  SELECT coalesce(sum(net),0), coalesce(sum(vat),0) INTO v_sub, v_vat
    FROM jsonb_to_recordset(p_lines) AS x(net numeric, vat numeric);
  v_tot := v_sub + v_vat;
  v_date := ((p_inv->>'issue_at')::timestamptz AT TIME ZONE 'Asia/Riyadh')::date;
  IF v_kind = 'credit' THEN
    SELECT * INTO rel FROM invoices WHERE id = (p_inv->>'related_invoice_id')::bigint;
    IF NOT FOUND OR rel.kind = 'credit' THEN RAISE EXCEPTION 'ERPX-E005: credit note must reference an issued invoice'; END IF;
    IF v_tot > fn_invoice_outstanding(rel.id) + coalesce((SELECT sum(amount) FROM invoice_payments WHERE invoice_id = rel.id),0) THEN
      RAISE EXCEPTION 'ERPX-E006: credit note exceeds the remaining credit-able amount of %', rel.number; END IF;
  END IF;
  -- accounting entry: debit AR / credit revenue + VAT (credit note = mirror image)
  SELECT jsonb_agg(j) INTO v_je FROM (
    SELECT jsonb_build_object('account','1130','partner_id',v_partner,
           CASE WHEN v_kind='credit' THEN 'credit' ELSE 'debit' END, v_tot, 'memo', p_inv->>'number') j
    UNION ALL
    SELECT jsonb_build_object('account', a.code, CASE WHEN v_kind='credit' THEN 'debit' ELSE 'credit' END, s.net, 'memo', p_inv->>'number')
      FROM (SELECT x.revenue_account, sum(x.net) net FROM jsonb_to_recordset(p_lines) AS x(revenue_account text, net numeric) GROUP BY 1) s
      JOIN accounts a ON a.code = s.revenue_account WHERE s.net <> 0
    UNION ALL
    SELECT jsonb_build_object('account','2110', CASE WHEN v_kind='credit' THEN 'debit' ELSE 'credit' END, v_vat, 'memo', p_inv->>'number') WHERE v_vat > 0
  ) q;
  v_entry := post_entry(v_date, (CASE v_kind WHEN 'credit' THEN 'Credit note ' WHEN 'debit' THEN 'Debit note ' ELSE 'Invoice ' END) || (p_inv->>'number'),
                        p_inv->>'branch', 'invoice', p_inv->>'number', v_user, v_je);
  INSERT INTO invoices(number,kind,issue_at,supply_date,due_date,partner_id,subtotal,vat_amount,total,related_invoice_id,reason,branch_id,lease_id,
                       rent_schedule_id,entry_id,uuid,icv,pih,invoice_hash,qr,xml,issued_by)
  VALUES (p_inv->>'number', v_kind, (p_inv->>'issue_at')::timestamptz, (p_inv->>'supply_date')::date, nullif(p_inv->>'due_date','')::date, v_partner,
          v_sub, v_vat, v_tot, nullif(p_inv->>'related_invoice_id','')::bigint, p_inv->>'reason',
          (SELECT id FROM branches WHERE code = p_inv->>'branch'), nullif(p_inv->>'lease_id','')::int, nullif(p_inv->>'rent_schedule_id','')::int,
          v_entry, (p_inv->>'uuid')::uuid, (p_inv->>'icv')::bigint, p_inv->>'pih', p_inv->>'invoice_hash', p_inv->>'qr', p_inv->>'xml', v_user)
  RETURNING id INTO v_id;
  INSERT INTO invoice_lines(invoice_id,line_no,description,qty,unit_price,discount,tax_code,vat_rate,net,vat,revenue_account_id)
  SELECT v_id, (row_number() OVER ())::smallint, x.description, x.qty, x.unit_price, coalesce(x.discount,0), x.tax_code, t.rate, x.net, x.vat, a.id
  FROM jsonb_to_recordset(p_lines) AS x(description text, qty numeric, unit_price numeric, discount numeric, tax_code text, net numeric, vat numeric, revenue_account text)
  JOIN tax_codes t ON t.code = x.tax_code JOIN accounts a ON a.code = x.revenue_account;
  IF nullif(p_inv->>'rent_schedule_id','') IS NOT NULL THEN
    UPDATE rent_schedule SET invoice_id = v_id WHERE id = (p_inv->>'rent_schedule_id')::int; END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION record_payment(p_invoice_id bigint, p_amount numeric, p_date date, p_cash_account text, p_method text, p_user text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i invoices; v_out numeric; v_entry bigint;
BEGIN
  SELECT * INTO i FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND OR i.kind = 'credit' THEN RAISE EXCEPTION 'ERPX-E007: payable invoice not found'; END IF;
  IF p_cash_account NOT LIKE '111%' AND p_cash_account NOT LIKE '112%' THEN RAISE EXCEPTION 'ERPX-E008: payment must go to a cash or bank account (111x/112x)'; END IF;
  v_out := fn_invoice_outstanding(p_invoice_id);
  IF p_amount <= 0 OR p_amount > v_out THEN RAISE EXCEPTION 'ERPX-E009: payment % exceeds outstanding % (no overpayment)', p_amount, v_out; END IF;
  v_entry := post_entry(p_date, 'Receipt for ' || i.number, (SELECT code FROM branches WHERE id = i.branch_id), 'payment', i.number, p_user,
     jsonb_build_array(jsonb_build_object('account', p_cash_account, 'debit', p_amount, 'memo', i.number),
                       jsonb_build_object('account', '1130', 'credit', p_amount, 'partner_id', i.partner_id, 'memo', i.number)));
  INSERT INTO invoice_payments(invoice_id,entry_id,amount,paid_on,method,created_by) VALUES (p_invoice_id, v_entry, p_amount, p_date, p_method, p_user);
  RETURN v_entry;
END $$;

CREATE FUNCTION verify_chain() RETURNS TABLE(ok boolean, entries bigint, first_bad_entry text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE prev text := repeat('0',64); r record; n bigint := 0; h text;
BEGIN
  FOR r IN SELECT * FROM journal_entries ORDER BY chain_no LOOP
    n := n + 1;
    h := encode(digest(prev||'|'||r.entry_no||'|'||to_char(r.entry_date,'YYYY-MM-DD')||'|'||r.total_base::numeric(20,2)::text||'|'||r.created_by,'sha256'),'hex');
    IF r.prev_hash <> prev OR r.row_hash <> h OR r.total_base <> (SELECT sum(debit) FROM journal_lines WHERE entry_id = r.id) THEN
      RETURN QUERY SELECT false, n, r.entry_no; RETURN; END IF;
    prev := r.row_hash;
  END LOOP;
  RETURN QUERY SELECT true, n, NULL::text;
END $$;
