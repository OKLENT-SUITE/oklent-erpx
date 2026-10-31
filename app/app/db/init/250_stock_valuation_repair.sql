-- 250: Repair and protect moving-average inventory valuation.
-- Legacy quantities with avg_cost=0 are never assigned a guessed cost from GL totals.
CREATE TABLE IF NOT EXISTS stock_valuation_events (
  id bigserial PRIMARY KEY,
  product_id int NOT NULL REFERENCES products,
  quantity numeric(20,4) NOT NULL,
  previous_avg_cost numeric(20,4) NOT NULL,
  new_avg_cost numeric(20,4) NOT NULL CHECK (new_avg_cost > 0),
  reference text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('initial_cost', 'migration_cost')),
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_valuation_events_product_idx ON stock_valuation_events(product_id, id DESC);
GRANT SELECT ON stock_valuation_events TO erpx_app;
GRANT USAGE, SELECT ON SEQUENCE stock_valuation_events_id_seq TO erpx_app;

-- Explicitly set the verified initial cost for positive, currently unvalued stock.
CREATE OR REPLACE FUNCTION set_stock_initial_cost(p_product int, p_unit_cost numeric, p_reference text, p_user text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c product_costing; v_event bigint;
BEGIN
  PERFORM set_config('erpx.user', coalesce(p_user, 'system'), true);
  IF p_unit_cost IS NULL OR p_unit_cost <= 0 THEN RAISE EXCEPTION 'ERPX-V001: unit cost must be greater than zero'; END IF;
  IF length(btrim(coalesce(p_reference,''))) < 2 THEN RAISE EXCEPTION 'ERPX-V002: source reference is required'; END IF;
  PERFORM 1 FROM products WHERE id=p_product AND stock_tracked FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-V003: tracked product not found'; END IF;
  PERFORM fn_ensure_costing(p_product);
  SELECT * INTO c FROM product_costing WHERE product_id=p_product FOR UPDATE;
  IF c.qty <= 0 THEN RAISE EXCEPTION 'ERPX-V004: product has no positive on-hand quantity'; END IF;
  IF c.avg_cost > 0 THEN RAISE EXCEPTION 'ERPX-V005: product already has a valued average cost'; END IF;
  UPDATE product_costing SET avg_cost=round(p_unit_cost,4), updated_at=now() WHERE product_id=p_product;
  INSERT INTO stock_valuation_events(product_id,quantity,previous_avg_cost,new_avg_cost,reference,event_type,actor)
    VALUES (p_product,c.qty,c.avg_cost,round(p_unit_cost,4),btrim(p_reference),'initial_cost',coalesce(p_user,'system')) RETURNING id INTO v_event;
  RETURN v_event;
END $$;
REVOKE EXECUTE ON FUNCTION set_stock_initial_cost(integer,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_stock_initial_cost(integer,numeric,text,text) TO erpx_app;

-- Replace the movement engine with a zero-cost guard. Unvalued balances must be repaired
-- from source documents before being sold or adjusted; otherwise COGS would silently be zero.
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
  IF c.avg_cost <= 0 AND p_kind IN ('sale','sale_return','adjustment') THEN RAISE EXCEPTION 'ERPX-V006: product % has zero average cost; record its verified initial cost before sale or stock adjustment', p.sku; END IF;
  IF p_qty > 0 AND p_kind IN ('opening', 'receipt') THEN
    v_cost := coalesce(p_unit_cost, c.avg_cost);
    IF v_cost < 0 THEN RAISE EXCEPTION 'ERPX-K042: unit cost cannot be negative'; END IF;
    IF c.qty > 0 AND c.avg_cost <= 0 THEN RAISE EXCEPTION 'ERPX-V006: product % has zero average cost; record its verified initial cost before receiving more stock', p.sku; END IF;
    v_new_avg := CASE WHEN c.qty <= 0 THEN v_cost ELSE round((c.qty * c.avg_cost + p_qty * v_cost) / (c.qty + p_qty), 4) END;
  ELSE
    v_cost := c.avg_cost; v_new_avg := c.avg_cost;
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
  VALUES (p_product, p_store, p_qty, p_kind, p_ref, p_note, coalesce(p_user, 'system'), v_cost, v_date, v_entry) RETURNING id INTO v_id;
  UPDATE product_costing SET qty = v_new_qty, avg_cost = v_new_avg, updated_at = now() WHERE product_id = p_product;
  RETURN QUERY SELECT v_id, v_cost, v_amt, v_entry;
END $$;
REVOKE EXECUTE ON FUNCTION stock_move_costed(integer,integer,numeric,text,text,text,text,numeric,date,bigint,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION stock_move_costed(integer,integer,numeric,text,text,text,text,numeric,date,bigint,boolean) TO erpx_app;

INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES ('schema', '{"version":"0.14.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now();
