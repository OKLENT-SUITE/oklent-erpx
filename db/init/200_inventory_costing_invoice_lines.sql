-- 200 (v0.9.0): inventory valuation at MOVING AVERAGE COST, automatic journal entries, product lines + rental periods on invoices.
-- Idempotent: CREATE OR REPLACE / IF NOT EXISTS only. No existing row is modified or deleted (stock_moves stays append-only).
--
-- Accounting policy (IFRS for SMEs s.13 Inventories: weighted-average cost formula is permitted):
--   purchase / receipt : Dr 1140 inventory (net) + Dr 1150 input VAT / Cr 2120 vendor (credit) or 1110 / 1121 (cash / bank); new average = (qty*avg + in_qty*in_cost) / (qty + in_qty)
--   sale (invoice)     : Dr 5100 cost of goods sold / Cr 1140 inventory, at the average cost AT THE TIME of issue (a sale never changes the average)
--   stock count        : shortage Dr 5100 / Cr 1140 ; surplus Dr 1140 / Cr 5100, at the current average
-- The average is kept per product (all stores) in product_costing and updated under the product row lock, in the same transaction as the movement.

-- ===== schema =====
ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS unit_cost numeric(20,4);                       -- NULL on legacy rows (valued at products.cost_price when the average was seeded)
ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS move_date date;                                -- business date of the movement (NULL on legacy rows = created_at)
ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS entry_id bigint REFERENCES journal_entries;    -- the journal entry created by / for this movement
CREATE INDEX IF NOT EXISTS stock_moves_entry_idx ON stock_moves (entry_id) WHERE entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS product_costing (
  product_id int PRIMARY KEY REFERENCES products,
  qty numeric(20,4) NOT NULL DEFAULT 0,                  -- quantity on hand, all stores
  avg_cost numeric(20,4) NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  updated_at timestamptz NOT NULL DEFAULT now());
-- seed once from the existing movements, valued at products.cost_price (the only cost the old version knew)
INSERT INTO product_costing(product_id, qty, avg_cost)
SELECT p.id, coalesce((SELECT sum(m.qty) FROM stock_moves m WHERE m.product_id = p.id), 0), p.cost_price FROM products p WHERE p.stock_tracked
ON CONFLICT (product_id) DO NOTHING;

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS product_id int REFERENCES products;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS period_from date;                            -- rental period (rental lines only)
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS period_to date;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_period_chk') THEN
    ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_period_chk CHECK ((period_from IS NULL) = (period_to IS NULL) AND (period_from IS NULL OR period_to >= period_from)); END IF; END $$;
CREATE INDEX IF NOT EXISTS invoice_lines_product_idx ON invoice_lines (product_id) WHERE product_id IS NOT NULL;

-- ===== helpers =====
CREATE OR REPLACE FUNCTION fn_riyadh_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date $$;

CREATE OR REPLACE FUNCTION fn_ensure_costing(p_product int) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO product_costing(product_id, qty, avg_cost)
  SELECT p.id, coalesce((SELECT sum(m.qty) FROM stock_moves m WHERE m.product_id = p.id), 0), p.cost_price FROM products p WHERE p.id = p_product
  ON CONFLICT (product_id) DO NOTHING $$;

-- value of all tracked stock at average cost, and the general-ledger balance of 1140 (they should agree)
CREATE OR REPLACE FUNCTION fn_stock_value() RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(round(sum(greatest(c.qty, 0) * c.avg_cost), 2), 0) FROM product_costing c JOIN products p ON p.id = c.product_id WHERE p.stock_tracked $$;
CREATE OR REPLACE FUNCTION fn_inventory_gl_balance() RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(jl.debit - jl.credit), 0) FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE a.code = '1140' $$;

-- ===== the one door for stock movements (valuation + optional journal entry) =====
-- p_post: post the COGS / adjustment entry here (sale, sale_return, adjustment). receipts/openings are posted by the caller (their credit side varies).
-- p_entry: an entry that already exists for this movement (purchase bill, aggregated invoice COGS) -> stored on the movement, nothing is posted here.
CREATE OR REPLACE FUNCTION stock_move_costed(p_product int, p_store int, p_qty numeric, p_kind text, p_ref text, p_note text, p_user text,
    p_unit_cost numeric DEFAULT NULL, p_date date DEFAULT NULL, p_entry bigint DEFAULT NULL, p_post boolean DEFAULT true)
RETURNS TABLE(r_move_id bigint, r_unit_cost numeric, r_amount numeric, r_entry_id bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p products; c product_costing; v_date date := coalesce(p_date, fn_riyadh_today()); v_cost numeric; v_amt numeric; v_entry bigint := p_entry;
        v_new_qty numeric; v_new_avg numeric; v_id bigint; v_branch text; v_lines jsonb; v_memo text;
BEGIN
  PERFORM set_config('erpx.user', coalesce(p_user, 'system'), true);
  IF v_date > fn_riyadh_today() THEN RAISE EXCEPTION 'ERPX-K040: a stock movement cannot be dated in the future'; END IF;
  IF p_qty IS NULL OR p_qty = 0 THEN RAISE EXCEPTION 'ERPX-K041: quantity must be non-zero'; END IF;
  SELECT * INTO p FROM products WHERE id = p_product FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-K003: product not found'; END IF;
  IF NOT p.stock_tracked THEN RAISE EXCEPTION 'ERPX-K003: product % does not track stock', p.sku; END IF;
  PERFORM fn_ensure_costing(p_product);
  SELECT * INTO c FROM product_costing WHERE product_id = p_product FOR UPDATE;
  IF p_qty > 0 AND p_kind IN ('opening', 'receipt') THEN
    v_cost := coalesce(p_unit_cost, c.avg_cost);
    IF v_cost < 0 THEN RAISE EXCEPTION 'ERPX-K042: unit cost cannot be negative'; END IF;
    v_new_avg := CASE WHEN c.qty <= 0 THEN v_cost ELSE round((c.qty * c.avg_cost + p_qty * v_cost) / (c.qty + p_qty), 4) END;   -- moving weighted average
  ELSE
    v_cost := c.avg_cost; v_new_avg := c.avg_cost;                                                                              -- issues and adjustments never change the average
  END IF;
  v_new_qty := c.qty + p_qty; v_amt := round(abs(p_qty) * v_cost, 2);
  IF p_post AND v_entry IS NULL AND v_amt > 0 AND p_kind IN ('sale', 'sale_return', 'adjustment') THEN
    SELECT b.code INTO v_branch FROM stores s JOIN branches b ON b.id = s.branch_id WHERE s.id = p_store;
    v_memo := CASE WHEN p_kind = 'sale' THEN 'تكلفة البضاعة المباعة ' WHEN p_kind = 'sale_return' THEN 'مرتجع مبيعات (تكلفة) ' ELSE 'تسوية جرد ' END || coalesce(p.sku, '') || ' ' || coalesce(p_ref, '');
    IF p_qty < 0 THEN v_lines := jsonb_build_array(jsonb_build_object('account', '5100', 'debit', v_amt, 'memo', p.sku), jsonb_build_object('account', '1140', 'credit', v_amt, 'memo', p.sku));
    ELSE v_lines := jsonb_build_array(jsonb_build_object('account', '1140', 'debit', v_amt, 'memo', p.sku), jsonb_build_object('account', '5100', 'credit', v_amt, 'memo', p.sku)); END IF;
    v_entry := post_entry(v_date, v_memo, v_branch, 'stock_' || p_kind, coalesce(p_ref, p.sku), p_user, v_lines);
  END IF;
  INSERT INTO stock_moves(product_id, store_id, qty, kind, ref, note, created_by, unit_cost, move_date, entry_id)
  VALUES (p_product, p_store, p_qty, p_kind, p_ref, p_note, coalesce(p_user, 'system'), v_cost, v_date, v_entry) RETURNING id INTO v_id;   -- trigger r15_stock_guard blocks overselling
  UPDATE product_costing SET qty = v_new_qty, avg_cost = v_new_avg, updated_at = now() WHERE product_id = p_product;
  RETURN QUERY SELECT v_id, v_cost, v_amt, v_entry;
END $$;

-- backward-compatible wrapper: every existing caller (POS, online orders, bookings, count, opening) now gets valuation + COGS automatically
CREATE OR REPLACE FUNCTION stock_move(p_product int, p_store int, p_qty numeric, p_kind text, p_ref text, p_note text, p_user text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN SELECT * INTO r FROM stock_move_costed(p_product, p_store, p_qty, p_kind, p_ref, p_note, p_user); RETURN r.r_move_id; END $$;

-- ===== purchase / goods receipt =====
-- mode: credit (vendor bill, Cr 2120) | cash (Cr 1110) | bank (Cr 1121). p_unit_cost NULL = quantity-only receipt at the current average (no entry).
CREATE OR REPLACE FUNCTION receive_stock(p_product int, p_store int, p_qty numeric, p_unit_cost numeric, p_date date, p_ref text, p_note text,
    p_mode text, p_vendor int, p_vat_rate numeric, p_due date, p_user text)
RETURNS TABLE(r_move_id bigint, r_entry_id bigint, r_amount numeric, r_avg_cost numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p products; v_date date := coalesce(p_date, fn_riyadh_today()); v_net numeric := 0; v_vat numeric := 0; v_branch text; v_entry bigint; v_bill int; v_acc text; v_lines jsonb; m record; v_vr numeric := coalesce(p_vat_rate, 0);
BEGIN
  PERFORM set_config('erpx.user', coalesce(p_user, 'system'), true);
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'ERPX-K041: received quantity must be positive'; END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN RAISE EXCEPTION 'ERPX-K042: unit cost cannot be negative'; END IF;
  IF v_vr NOT IN (0, 15) THEN RAISE EXCEPTION 'ERPX-B004: VAT rate must be 0 or 15'; END IF;
  IF v_date > fn_riyadh_today() THEN RAISE EXCEPTION 'ERPX-K040: a receipt cannot be dated in the future'; END IF;
  SELECT * INTO p FROM products WHERE id = p_product;
  IF NOT FOUND OR NOT p.stock_tracked OR p.kind <> 'goods' THEN RAISE EXCEPTION 'ERPX-K003: product does not track stock'; END IF;
  SELECT b.code INTO v_branch FROM stores s JOIN branches b ON b.id = s.branch_id WHERE s.id = p_store;
  IF p_unit_cost IS NOT NULL THEN v_net := round(p_qty * p_unit_cost, 2); v_vat := round(v_net * v_vr / 100, 2); END IF;
  IF v_net > 0 THEN
    IF coalesce(p_mode, 'cash') NOT IN ('credit', 'cash', 'bank') THEN RAISE EXCEPTION 'ERPX-K044: purchase mode must be credit, cash or bank'; END IF;
    IF p_mode = 'credit' THEN
      IF p_vendor IS NULL THEN RAISE EXCEPTION 'ERPX-K045: choose the vendor for a credit purchase'; END IF;
      IF length(btrim(coalesce(p_ref, ''))) = 0 THEN RAISE EXCEPTION 'ERPX-K046: the supplier invoice number is required for a credit purchase'; END IF;
      v_bill := record_vendor_bill(p_vendor, p_ref, v_date, greatest(coalesce(p_due, v_date), v_date), '1140', v_net, v_vr, v_branch, coalesce(nullif(p_note, ''), 'استلام بضاعة ' || p.sku), p_user);
      SELECT entry_id INTO v_entry FROM vendor_bills WHERE id = v_bill;
    ELSE
      v_acc := CASE WHEN p_mode = 'bank' THEN '1121' ELSE '1110' END;
      v_lines := jsonb_build_array(jsonb_build_object('account', '1140', 'debit', v_net, 'memo', p.sku));
      IF v_vat > 0 THEN v_lines := v_lines || jsonb_build_object('account', '1150', 'debit', v_vat, 'memo', 'VAT input ' || coalesce(p_ref, p.sku)); END IF;
      v_lines := v_lines || jsonb_build_object('account', v_acc, 'credit', v_net + v_vat, 'memo', coalesce(p_ref, p.sku));
      v_entry := post_entry(v_date, coalesce(nullif(p_note, ''), 'شراء بضاعة ' || p.sku || ' ' || coalesce(p_ref, '')), v_branch, 'stock_receipt', coalesce(p_ref, p.sku), p_user, v_lines);
    END IF;
  END IF;
  SELECT * INTO m FROM stock_move_costed(p_product, p_store, p_qty, 'receipt', p_ref, p_note, p_user, p_unit_cost, v_date, v_entry, false);
  RETURN QUERY SELECT m.r_move_id, v_entry, v_net, (SELECT avg_cost FROM product_costing WHERE product_id = p_product);
END $$;

-- ===== invoice approval -> stock cycle: ONE aggregated COGS entry per invoice (Dr 5100 / Cr 1140) + one stock movement per product =====
CREATE OR REPLACE FUNCTION post_invoice_stock(p_invoice bigint, p_store int, p_user text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i invoices; r record; v_total numeric := 0; v_entry bigint; v_branch text; v_date date; v_amt numeric; v_avg numeric; v_lines jsonb := '[]';
BEGIN
  PERFORM set_config('erpx.user', coalesce(p_user, 'system'), true);
  SELECT * INTO i FROM invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-K047: invoice not found'; END IF;
  IF i.kind IN ('credit', 'debit') THEN RETURN 0; END IF;
  v_date := (i.issue_at AT TIME ZONE 'Asia/Riyadh')::date;
  SELECT code INTO v_branch FROM branches WHERE id = i.branch_id;
  FOR r IN SELECT l.product_id, sum(l.qty) qty, p.sku FROM invoice_lines l JOIN products p ON p.id = l.product_id
           WHERE l.invoice_id = p_invoice AND p.stock_tracked AND p.kind = 'goods' GROUP BY l.product_id, p.sku ORDER BY l.product_id LOOP
    PERFORM 1 FROM products WHERE id = r.product_id FOR UPDATE;
    PERFORM fn_ensure_costing(r.product_id);
    SELECT avg_cost INTO v_avg FROM product_costing WHERE product_id = r.product_id FOR UPDATE;
    v_amt := round(r.qty * v_avg, 2); v_total := v_total + v_amt;
  END LOOP;
  IF v_total > 0 THEN
    v_entry := post_entry(v_date, 'تكلفة البضاعة المباعة - فاتورة ' || i.number, v_branch, 'cogs', i.number, p_user,
      jsonb_build_array(jsonb_build_object('account', '5100', 'debit', v_total, 'memo', i.number), jsonb_build_object('account', '1140', 'credit', v_total, 'memo', i.number)));
  END IF;
  FOR r IN SELECT l.product_id, sum(l.qty) qty FROM invoice_lines l JOIN products p ON p.id = l.product_id
           WHERE l.invoice_id = p_invoice AND p.stock_tracked AND p.kind = 'goods' GROUP BY l.product_id ORDER BY l.product_id LOOP
    PERFORM stock_move_costed(r.product_id, p_store, -r.qty, 'sale', i.number, NULL, p_user, NULL, v_date, v_entry, false);   -- raises ERPX-K001 when stock is short -> the whole invoice rolls back
  END LOOP;
  RETURN v_total;
END $$;

-- one-time reconciliation: stock that existed BEFORE this version has no ledger entry. Posts Dr 1140 / Cr <equity account> for the positive difference only.
CREATE OR REPLACE FUNCTION post_stock_opening_valuation(p_date date, p_equity text, p_user text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_gap numeric;
BEGIN
  PERFORM set_config('erpx.user', coalesce(p_user, 'system'), true);
  IF p_equity IS NULL OR NOT EXISTS (SELECT 1 FROM accounts WHERE code = p_equity AND type = 'equity' AND is_postable AND is_active) THEN RAISE EXCEPTION 'ERPX-K048: choose a postable equity account (3xxx)'; END IF;
  v_gap := round(fn_stock_value() - fn_inventory_gl_balance(), 2);
  IF v_gap < 0.01 THEN RAISE EXCEPTION 'ERPX-K049: inventory in the ledger already covers the stock value (difference %)', v_gap; END IF;
  RETURN post_entry(coalesce(p_date, fn_riyadh_today()), 'قيد رصيد افتتاحي للمخزون بمتوسط التكلفة', NULL, 'stock_opening', 'opening-valuation', p_user,
    jsonb_build_array(jsonb_build_object('account', '1140', 'debit', v_gap, 'memo', 'opening stock'), jsonb_build_object('account', p_equity, 'credit', v_gap, 'memo', 'opening stock')));
END $$;

-- ===== privileges =====
GRANT SELECT ON product_costing TO erpx_app;
REVOKE EXECUTE ON FUNCTION fn_riyadh_today, fn_ensure_costing, fn_stock_value, fn_inventory_gl_balance, stock_move_costed, receive_stock, post_invoice_stock, post_stock_opening_valuation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_riyadh_today, fn_ensure_costing, fn_stock_value, fn_inventory_gl_balance, stock_move_costed, receive_stock, post_invoice_stock, post_stock_opening_valuation TO erpx_app;

-- ===== record_invoice: keep the line's product and rental period (CREATE OR REPLACE of the 040 function; only the last INSERT differs) =====
CREATE OR REPLACE FUNCTION record_invoice(p_inv jsonb, p_lines jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  INSERT INTO invoice_lines(invoice_id,line_no,description,qty,unit_price,discount,tax_code,vat_rate,net,vat,revenue_account_id,product_id,period_from,period_to)
  SELECT v_id, (row_number() OVER ())::smallint, x.description, x.qty, x.unit_price, coalesce(x.discount,0), x.tax_code, t.rate, x.net, x.vat, a.id, x.product_id, x.period_from, x.period_to
  FROM jsonb_to_recordset(p_lines) AS x(description text, qty numeric, unit_price numeric, discount numeric, tax_code text, net numeric, vat numeric, revenue_account text, product_id int, period_from date, period_to date)
  JOIN tax_codes t ON t.code = x.tax_code JOIN accounts a ON a.code = x.revenue_account;
  IF nullif(p_inv->>'rent_schedule_id','') IS NOT NULL THEN
    UPDATE rent_schedule SET invoice_id = v_id WHERE id = (p_inv->>'rent_schedule_id')::int; END IF;
  RETURN v_id;
END $$;

INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES ('schema', '{"version": "0.9.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
