-- 160: fixes from the 0.5.0 code review. Idempotent (CREATE OR REPLACE / IF NOT EXISTS): safe on a new AND on an existing database.
--  1. Stock reservation also counts orders that were FULFILLED but not yet invoiced (they used to free the stock without deducting it -> overselling).
--  2. A sale (POS / order invoicing) may not consume stock reserved by other online orders (available = on hand - reserved).
--  3. The public cart refuses the same product twice (splitting a line used to bypass the stock check).
CREATE OR REPLACE FUNCTION fn_reserved(p_product int, p_store int) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(l.qty),0) FROM online_order_lines l JOIN online_orders o ON o.id = l.order_id
  WHERE l.product_id = p_product AND o.store_id = p_store AND o.status IN ('new','confirmed','fulfilled') AND o.invoice_id IS NULL $$;

CREATE OR REPLACE FUNCTION stock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products;
BEGIN
  SELECT * INTO p FROM products WHERE id = NEW.product_id FOR UPDATE;       -- serialises concurrent movements of the same product
  IF NOT p.stock_tracked THEN RAISE EXCEPTION 'ERPX-K003: product % does not track stock', p.sku; END IF;
  IF NEW.qty < 0 AND NOT p.allow_negative THEN
    IF fn_on_hand(NEW.product_id, NEW.store_id) + NEW.qty < 0 THEN
      RAISE EXCEPTION 'ERPX-K001: insufficient stock for % (on hand %, requested %)', p.sku, fn_on_hand(NEW.product_id, NEW.store_id), -NEW.qty; END IF;
    IF NEW.kind = 'sale' AND fn_available(NEW.product_id, NEW.store_id) + NEW.qty < 0 THEN
      RAISE EXCEPTION 'ERPX-K001: insufficient available stock for % (on hand %, reserved by online orders %, requested %)', p.sku,
        fn_on_hand(NEW.product_id, NEW.store_id), fn_reserved(NEW.product_id, NEW.store_id), -NEW.qty; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION place_online_order(p_slug text, p_customer jsonb, p_lines jsonb, p_payment text, p_notes text)
RETURNS TABLE(number text, total numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s stores; w store_site; l jsonb; p products; v_qty int; v_disc numeric; v_net numeric; v_vat numeric; v_rate numeric; v_sub numeric := 0; v_tv numeric := 0; v_rows jsonb := '[]';
        v_id int; v_no text; v_partner int; v_name text := btrim(p_customer->>'name'); v_phone text := btrim(p_customer->>'phone'); v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
  PERFORM set_config('erpx.user', 'online', true);
  SELECT * INTO s FROM stores WHERE slug = p_slug AND is_active;
  SELECT * INTO w FROM store_site WHERE store_id = s.id AND is_published;
  IF s.id IS NULL OR w.store_id IS NULL OR NOT ('online_shop' = ANY (s.features)) THEN RAISE EXCEPTION 'ERPX-S002: store is not open for online orders'; END IF;
  IF length(coalesce(v_name,'')) < 2 OR v_phone !~ '^\+?[0-9]{9,14}$' OR length(coalesce(btrim(p_customer->>'address'),'')) < 3 THEN RAISE EXCEPTION 'ERPX-O006: customer name, phone and address are required'; END IF;
  IF NOT (p_payment = ANY (w.payment_methods)) THEN RAISE EXCEPTION 'ERPX-O007: payment method not accepted by this store'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'ERPX-O008: cart must contain 1 to 50 lines'; END IF;
  IF (SELECT count(DISTINCT x->>'product_id') FROM jsonb_array_elements(p_lines) x) <> jsonb_array_length(p_lines) THEN RAISE EXCEPTION 'ERPX-O008: each product may appear once in the cart (merge the quantities)'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (l->>'qty')::int; IF v_qty NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'ERPX-O008: quantity must be 1..999'; END IF;
    SELECT * INTO p FROM products WHERE id = (l->>'product_id')::int AND is_active AND published AND kind = 'goods' FOR UPDATE;   -- services/rentals are booked, not carted
    IF p.id IS NULL THEN RAISE EXCEPTION 'ERPX-O009: product % is not available for ordering', l->>'product_id'; END IF;
    IF p.stock_tracked AND NOT p.allow_negative AND fn_available(p.id, s.id) < v_qty THEN RAISE EXCEPTION 'ERPX-K002: insufficient stock for %', p.name_ar; END IF;
    v_disc := round(v_qty * fn_unit_discount(p.id, s.id, v_today), 2);
    v_net := round(v_qty * p.sale_price - v_disc, 2); SELECT rate INTO v_rate FROM tax_codes WHERE code = p.tax_code; v_vat := round(v_net * v_rate / 100, 2);
    v_rows := v_rows || jsonb_build_object('product_id', p.id, 'description', p.name_ar, 'qty', v_qty, 'unit_price', p.sale_price, 'discount', v_disc,
              'tax_code', p.tax_code, 'net', v_net, 'vat', v_vat, 'revenue_account', (SELECT code FROM accounts WHERE id = p.revenue_account_id));
    v_sub := v_sub + v_net; v_tv := v_tv + v_vat;
  END LOOP;
  IF v_sub < w.min_order THEN RAISE EXCEPTION 'ERPX-O010: minimum order is % SAR (excl. VAT)', w.min_order; END IF;
  IF 'delivery' = ANY (s.features) AND w.delivery_fee > 0 AND (w.free_delivery_over IS NULL OR v_sub < w.free_delivery_over) THEN
    v_vat := round(w.delivery_fee * 0.15, 2);
    v_rows := v_rows || jsonb_build_object('description','رسوم التوصيل','qty',1,'unit_price',w.delivery_fee,'discount',0,'tax_code','S15','net',w.delivery_fee,'vat',v_vat,'revenue_account','4900');
    v_sub := v_sub + w.delivery_fee; v_tv := v_tv + v_vat;
  END IF;
  SELECT id INTO v_partner FROM partners WHERE phone = v_phone AND kind = 'customer' ORDER BY id LIMIT 1;
  IF v_partner IS NULL THEN INSERT INTO partners(kind,name_ar,phone,city) VALUES ('customer', v_name, v_phone, left(p_customer->>'city',60)) RETURNING id INTO v_partner; END IF;
  v_no := 'ORD-' || to_char(v_today,'YYYY') || '-' || lpad(next_number('ORD-' || to_char(v_today,'YYYY'))::text, 6, '0');
  INSERT INTO online_orders(number,store_id,partner_id,customer_name,phone,city,address,payment_method,notes,subtotal,vat_amount,total)
  VALUES (v_no, s.id, v_partner, v_name, v_phone, left(p_customer->>'city',60), left(p_customer->>'address',250), p_payment, left(p_notes,500), v_sub, v_tv, v_sub + v_tv) RETURNING id INTO v_id;
  INSERT INTO online_order_lines(order_id,product_id,description,qty,unit_price,discount,tax_code,net,vat,revenue_account)
  SELECT v_id, r.product_id, r.description, r.qty, r.unit_price, r.discount, r.tax_code, r.net, r.vat, r.revenue_account
  FROM jsonb_to_recordset(v_rows) AS r(product_id int, description text, qty numeric, unit_price numeric, discount numeric, tax_code text, net numeric, vat numeric, revenue_account text);
  RETURN QUERY SELECT v_no, v_sub + v_tv;
END $$;

CREATE INDEX IF NOT EXISTS bookings_sched_idx ON bookings (scheduled_at);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings (status);
CREATE INDEX IF NOT EXISTS online_orders_status_idx ON online_orders (store_id, status);

-- schema marker (the API warns when the database is older than the code)
INSERT INTO app_settings(key, value) VALUES ('schema', '{"version":"0.5.0"}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
