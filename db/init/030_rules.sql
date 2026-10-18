-- 030: THE RULES. Every accounting rule is enforced here, inside PostgreSQL, so no client
-- (web, API, CLI, psql, a future mobile app) can bypass it. Error codes ERPX-xxxx are stable.

-- ---------- helpers ----------
CREATE FUNCTION next_number(p_name text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO sequences(name,last_value) VALUES (p_name,1)
  ON CONFLICT (name) DO UPDATE SET last_value = sequences.last_value + 1
  RETURNING last_value $$;   -- row lock + same transaction => gapless, rolled back with the entry
COMMENT ON FUNCTION next_number IS 'Gapless numbering: the counter row is locked and rolls back with the transaction.';

CREATE FUNCTION zatca_genesis_pih() RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT replace(encode(convert_to(encode(digest('0','sha256'),'hex'),'UTF8'),'base64'), E'\n','') $$;

-- ---------- R1 immutability ----------
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ERPX-I001: % is append-only; % is not allowed. Post a reversal / credit note instead.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['journal_entries','journal_lines','audit_log','invoices','invoice_lines','invoice_payments','exchange_rates'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', 'r1_'||t||'_row', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', 'r1_'||t||'_trunc', t);
  END LOOP;
END $$;

-- ---------- R2 period must be open + R3 hash chain (entries) ----------
CREATE FUNCTION je_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pid int; v_status text; v_prev text; v_chain bigint;
BEGIN
  SELECT id,status INTO v_pid,v_status FROM fiscal_periods WHERE NEW.entry_date BETWEEN start_date AND end_date;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'ERPX-P001: no fiscal period covers %', NEW.entry_date; END IF;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'ERPX-P002: period is % - posting refused (date %)', v_status, NEW.entry_date; END IF;
  NEW.period_id := v_pid;
  PERFORM pg_advisory_xact_lock(7001);                         -- serialises the chain
  SELECT chain_no, row_hash INTO v_chain, v_prev FROM journal_entries ORDER BY chain_no DESC LIMIT 1;
  NEW.chain_no := coalesce(v_chain,0) + 1;
  NEW.prev_hash := coalesce(v_prev, repeat('0',64));
  NEW.row_hash := encode(digest(NEW.prev_hash||'|'||NEW.entry_no||'|'||to_char(NEW.entry_date,'YYYY-MM-DD')||'|'||
                  NEW.total_base::numeric(20,2)::text||'|'||NEW.created_by,'sha256'),'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER r2_je_before_insert BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION je_before_insert();

-- ---------- R4 line validation (postable account, currency maths) ----------
CREATE FUNCTION jl_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a record; v_base char(3);
BEGIN
  SELECT is_postable,is_active,code INTO a FROM accounts WHERE id = NEW.account_id;
  IF NOT a.is_postable THEN RAISE EXCEPTION 'ERPX-A001: account % is a header account - not postable', a.code; END IF;
  IF NOT a.is_active  THEN RAISE EXCEPTION 'ERPX-A002: account % is inactive', a.code; END IF;
  SELECT code INTO v_base FROM currencies WHERE is_base;
  IF NEW.currency_code = v_base AND NEW.rate <> 1 THEN RAISE EXCEPTION 'ERPX-C002: base-currency line must have rate 1'; END IF;
  IF round(abs(NEW.amount_currency) * NEW.rate, 2) <> NEW.debit + NEW.credit THEN
    RAISE EXCEPTION 'ERPX-C003: base amount % does not equal amount_currency % x rate %', NEW.debit+NEW.credit, NEW.amount_currency, NEW.rate; END IF;
  IF (NEW.amount_currency > 0) <> (NEW.debit > 0) THEN RAISE EXCEPTION 'ERPX-C004: sign of amount_currency contradicts debit/credit side'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER r4_jl_before_insert BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION jl_before_insert();

-- ---------- R5 double entry: DEFERRED to COMMIT so lines may be inserted one by one ----------
CREATE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint; d numeric; c numeric; n int; t numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN v_id := NEW.id; ELSE v_id := NEW.entry_id; END IF;
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) INTO d,c,n FROM journal_lines WHERE entry_id = v_id;
  SELECT total_base INTO t FROM journal_entries WHERE id = v_id;
  IF n < 2 THEN RAISE EXCEPTION 'ERPX-J002: entry % needs at least 2 lines (has %)', v_id, n; END IF;
  IF d <> c THEN RAISE EXCEPTION 'ERPX-J001: entry % is unbalanced: debit % <> credit %', v_id, d, c; END IF;
  IF d <> t THEN RAISE EXCEPTION 'ERPX-J003: entry % header total % <> lines total %', v_id, t, d; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER r5_balanced_on_lines AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();
CREATE CONSTRAINT TRIGGER r5_balanced_on_entry AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- ---------- R6 chart of accounts integrity ----------
CREATE FUNCTION accounts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT type,is_postable INTO p FROM accounts WHERE id = NEW.parent_id;
    IF p.type <> NEW.type THEN RAISE EXCEPTION 'ERPX-A003: child account type must equal parent type'; END IF;
    IF p.is_postable THEN RAISE EXCEPTION 'ERPX-A004: parent account must be a header (non-postable)'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id LIMIT 1)
       AND (OLD.code <> NEW.code OR OLD.type <> NEW.type OR (OLD.is_postable AND NOT NEW.is_postable)) THEN
      RAISE EXCEPTION 'ERPX-A005: account % has postings - code/type/postable are frozen', OLD.code; END IF;
    IF NEW.is_postable AND EXISTS (SELECT 1 FROM accounts WHERE parent_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION 'ERPX-A004: an account with children cannot be postable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER r6_accounts_guard BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION accounts_guard();
CREATE FUNCTION accounts_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ERPX-A006: accounts are never deleted - deactivate instead' USING ERRCODE='integrity_constraint_violation'; END $$;
CREATE TRIGGER r6_accounts_nodel BEFORE DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION accounts_no_delete();

-- ---------- R7 period state machine (open -> closed -> locked) ----------
CREATE FUNCTION periods_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ERPX-P010: fiscal periods cannot be deleted' USING ERRCODE='integrity_constraint_violation'; END IF;
  IF OLD.status = 'locked' THEN RAISE EXCEPTION 'ERPX-P005: period % is locked permanently', OLD.name; END IF;
  IF (OLD.start_date,OLD.end_date) IS DISTINCT FROM (NEW.start_date,NEW.end_date)
     AND EXISTS (SELECT 1 FROM journal_entries WHERE period_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'ERPX-P006: cannot change dates of a period that has entries'; END IF;
  IF OLD.status <> NEW.status THEN
    IF coalesce(current_setting('erpx.allow_period_change', true),'') <> 'on' THEN
      RAISE EXCEPTION 'ERPX-P007: use close_period()/reopen_period()/lock_period() to change period status'; END IF;
    IF NEW.status = 'closed' AND EXISTS (SELECT 1 FROM fiscal_periods WHERE start_date < OLD.start_date AND status = 'open') THEN
      RAISE EXCEPTION 'ERPX-P003: close earlier periods first (sequential closing)'; END IF;
    IF NEW.status = 'open' AND EXISTS (SELECT 1 FROM fiscal_periods WHERE start_date > OLD.start_date AND status <> 'open') THEN
      RAISE EXCEPTION 'ERPX-P004: reopen later periods first'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER r7_periods_guard BEFORE UPDATE OR DELETE ON fiscal_periods FOR EACH ROW EXECUTE FUNCTION periods_guard();

-- ---------- R8 e-invoice chain (ICV gapless, PIH = previous invoice hash) ----------
CREATE FUNCTION invoice_chain_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l_icv bigint; l_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(7002);
  SELECT icv,invoice_hash INTO l_icv,l_hash FROM invoices ORDER BY icv DESC LIMIT 1;
  IF NEW.icv <> coalesce(l_icv,0) + 1 THEN RAISE EXCEPTION 'ERPX-E001: ICV must be % (got %) - invoice counter is gapless', coalesce(l_icv,0)+1, NEW.icv; END IF;
  IF NEW.pih <> coalesce(l_hash, zatca_genesis_pih()) THEN RAISE EXCEPTION 'ERPX-E002: PIH does not match the previous invoice hash'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER r8_invoice_chain BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION invoice_chain_guard();

CREATE FUNCTION check_invoice_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint; s numeric; v numeric; i record;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN v_id := NEW.id; ELSE v_id := NEW.invoice_id; END IF;
  SELECT coalesce(sum(net),0), coalesce(sum(vat),0) INTO s,v FROM invoice_lines WHERE invoice_id = v_id;
  SELECT subtotal,vat_amount INTO i FROM invoices WHERE id = v_id;
  IF s <> i.subtotal OR v <> i.vat_amount THEN
    RAISE EXCEPTION 'ERPX-E003: invoice % lines (net %, vat %) differ from header (%, %)', v_id, s, v, i.subtotal, i.vat_amount; END IF;
  IF EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = v_id AND
       (round(qty*unit_price-discount,2) <> net OR round(net*vat_rate/100,2) <> vat)) THEN
    RAISE EXCEPTION 'ERPX-E004: line net must be qty x price - discount, and VAT must be net x rate'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER r8_inv_totals_h AFTER INSERT ON invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_invoice_totals();
CREATE CONSTRAINT TRIGGER r8_inv_totals_l AFTER INSERT ON invoice_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_invoice_totals();

-- rent_schedule.invoice_id may be set exactly once
CREATE FUNCTION rent_schedule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.invoice_id IS NOT NULL OR (OLD.lease_id,OLD.seq,OLD.due_date,OLD.amount) IS DISTINCT FROM (NEW.lease_id,NEW.seq,NEW.due_date,NEW.amount) THEN
    RAISE EXCEPTION 'ERPX-L001: a billed rent installment is frozen'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER r9_rent_guard BEFORE UPDATE ON rent_schedule FOR EACH ROW EXECUTE FUNCTION rent_schedule_guard();

-- ---------- R10 generic audit trail ----------
CREATE FUNCTION audit_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  o := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'pw_hash' END;
  n := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'pw_hash' END;
  INSERT INTO audit_log(actor,table_name,op,row_pk,old_data,new_data)
  VALUES (coalesce(current_setting('erpx.user',true),session_user), TG_TABLE_NAME, TG_OP, coalesce(n,o)->>'id', o, n);
  RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','partners','fiscal_periods','branches','properties','units','leases','users','company'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trg()','r10_audit_'||t,t);
  END LOOP;
END $$;
