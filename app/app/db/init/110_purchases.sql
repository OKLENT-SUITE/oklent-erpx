-- 110: purchases (المشتريات): vendor bills with input VAT, payables (2120), vendor payments, AP aging.
-- Existing install:  docker compose exec -T db psql -U erpx_owner -d erpx -v ON_ERROR_STOP=1 < db/init/110_purchases.sql
CREATE TABLE vendor_bills (
  id serial PRIMARY KEY, number text UNIQUE NOT NULL,
  vendor_id int NOT NULL REFERENCES partners, supplier_ref text NOT NULL CHECK (length(btrim(supplier_ref)) > 0),
  bill_date date NOT NULL, due_date date NOT NULL, CHECK (due_date >= bill_date),
  account_id int NOT NULL REFERENCES accounts, branch_id int REFERENCES branches, memo text,
  net numeric(20,2) NOT NULL CHECK (net > 0), vat_rate numeric(5,2) NOT NULL CHECK (vat_rate IN (0,15)), vat numeric(20,2) NOT NULL CHECK (vat >= 0),
  total numeric(20,2) NOT NULL, CHECK (total = net + vat), entry_id bigint NOT NULL REFERENCES journal_entries,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, supplier_ref));                         -- the same supplier invoice cannot be entered twice
CREATE TABLE vendor_payments (
  id serial PRIMARY KEY, bill_id int NOT NULL REFERENCES vendor_bills, entry_id bigint NOT NULL REFERENCES journal_entries,
  amount numeric(20,2) NOT NULL CHECK (amount > 0), paid_on date NOT NULL, method text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER r12_vendor_bills_immutable BEFORE UPDATE OR DELETE ON vendor_bills FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER r12_vendor_payments_immutable BEFORE UPDATE OR DELETE ON vendor_payments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION fn_bill_outstanding(p_id int) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT b.total - coalesce((SELECT sum(amount) FROM vendor_payments WHERE bill_id = b.id), 0) FROM vendor_bills b WHERE b.id = p_id $$;

CREATE FUNCTION record_vendor_bill(p_vendor int, p_ref text, p_date date, p_due date, p_account text, p_net numeric, p_vat_rate numeric, p_branch text, p_memo text, p_user text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_acc accounts; v_vat numeric; v_total numeric; v_entry bigint; v_id int; v_no text; v_lines jsonb;
BEGIN
  PERFORM set_config('erpx.user', p_user, true);
  IF NOT EXISTS (SELECT 1 FROM partners WHERE id = p_vendor AND kind = 'vendor' AND is_active) THEN RAISE EXCEPTION 'ERPX-B002: vendor not found (partner must be of kind vendor)'; END IF;
  SELECT * INTO v_acc FROM accounts WHERE code = p_account AND is_postable AND is_active;
  IF v_acc.id IS NULL OR NOT (v_acc.type = 'expense' OR v_acc.code = '1140' OR v_acc.code LIKE '12%') THEN RAISE EXCEPTION 'ERPX-B003: bill account must be an expense, inventory (1140) or fixed-asset (12xx) account'; END IF;
  IF p_vat_rate NOT IN (0,15) THEN RAISE EXCEPTION 'ERPX-B004: VAT rate must be 0 or 15'; END IF;
  v_vat := round(p_net * p_vat_rate / 100, 2); v_total := p_net + v_vat;
  v_no := 'PB-' || to_char(p_date,'YYYY') || '-' || lpad(next_number('PB-' || to_char(p_date,'YYYY'))::text, 6, '0');
  v_lines := jsonb_build_array(jsonb_build_object('account', p_account, 'debit', p_net, 'memo', p_ref));
  IF v_vat > 0 THEN v_lines := v_lines || jsonb_build_object('account','1150','debit',v_vat,'memo','VAT input ' || p_ref); END IF;
  v_lines := v_lines || jsonb_build_object('account','2120','credit',v_total,'partner_id',p_vendor,'memo',p_ref);
  v_entry := post_entry(p_date, coalesce(nullif(p_memo,''), 'فاتورة مورد ' || p_ref), p_branch, 'vendor_bill', v_no, p_user, v_lines);
  INSERT INTO vendor_bills(number,vendor_id,supplier_ref,bill_date,due_date,account_id,branch_id,memo,net,vat_rate,vat,total,entry_id,created_by)
  VALUES (v_no,p_vendor,p_ref,p_date,p_due,v_acc.id,(SELECT id FROM branches WHERE code = p_branch),p_memo,p_net,p_vat_rate,v_vat,v_total,v_entry,p_user) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION pay_vendor_bill(p_bill int, p_amount numeric, p_date date, p_cash_account text, p_method text, p_user text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b vendor_bills; v_out numeric; v_entry bigint;
BEGIN
  PERFORM set_config('erpx.user', p_user, true);
  SELECT * INTO b FROM vendor_bills WHERE id = p_bill FOR UPDATE;      -- serialises concurrent payments of the same bill
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-B005: bill not found'; END IF;
  IF p_cash_account NOT LIKE '111%' AND p_cash_account NOT LIKE '112%' THEN RAISE EXCEPTION 'ERPX-B006: payment must come from a cash or bank account (111x/112x)'; END IF;
  v_out := fn_bill_outstanding(p_bill);
  IF p_amount <= 0 OR p_amount > v_out THEN RAISE EXCEPTION 'ERPX-B007: payment % exceeds outstanding % (no overpayment)', p_amount, v_out; END IF;
  v_entry := post_entry(p_date, 'سداد فاتورة مورد ' || b.supplier_ref, (SELECT code FROM branches WHERE id = b.branch_id), 'vendor_payment', b.number, p_user,
    jsonb_build_array(jsonb_build_object('account','2120','debit',p_amount,'partner_id',b.vendor_id,'memo',b.supplier_ref), jsonb_build_object('account',p_cash_account,'credit',p_amount,'memo',b.supplier_ref)));
  INSERT INTO vendor_payments(bill_id,entry_id,amount,paid_on,method,created_by) VALUES (p_bill,v_entry,p_amount,p_date,p_method,p_user);
  RETURN v_entry;
END $$;

CREATE FUNCTION fn_ap_aging(p_as_of date) RETURNS TABLE(vendor text, bill_no text, supplier_ref text, due_date date, outstanding numeric, bucket text) LANGUAGE sql STABLE AS $$
  SELECT p.name_ar, b.number, b.supplier_ref, b.due_date, fn_bill_outstanding(b.id),
    CASE WHEN p_as_of - b.due_date <= 0 THEN 'غير مستحق' WHEN p_as_of - b.due_date <= 30 THEN '1-30' WHEN p_as_of - b.due_date <= 60 THEN '31-60' WHEN p_as_of - b.due_date <= 90 THEN '61-90' ELSE '90+' END
  FROM vendor_bills b JOIN partners p ON p.id = b.vendor_id WHERE b.bill_date <= p_as_of AND fn_bill_outstanding(b.id) > 0 ORDER BY 1, 4 $$;

GRANT SELECT ON vendor_bills, vendor_payments TO erpx_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erpx_app;
REVOKE EXECUTE ON FUNCTION fn_bill_outstanding, record_vendor_bill, pay_vendor_bill, fn_ap_aging FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_bill_outstanding, record_vendor_bill, pay_vendor_bill, fn_ap_aging TO erpx_app;
