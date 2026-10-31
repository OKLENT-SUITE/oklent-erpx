-- 190: service requests may include PRODUCT add-ons (0.8.0). Idempotent: CREATE OR REPLACE only; no data is touched.
-- Rules enforced here (never in the browser): at least one service/rental line (ERPX-K029); goods lines must be published, active and available (ERPX-K028);
-- price, discount and VAT are computed by the database as before. Stock is deducted when the completed request is invoiced (see POST /api/bookings/:id/invoice).
CREATE OR REPLACE FUNCTION place_booking(p_slug text, p_customer jsonb, p_when jsonb, p_lines jsonb)
RETURNS TABLE(number text, total numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s stores; w store_site; l jsonb; p products; v_qty int; v_disc numeric; v_net numeric; v_vat numeric; v_rate numeric; v_sub numeric := 0; v_tv numeric := 0; v_rows jsonb := '[]';
        v_name text := btrim(p_customer->>'name'); v_phone text := btrim(p_customer->>'phone'); v_city int; v_dist int; v_at timestamp; v_now timestamp := now() AT TIME ZONE 'Asia/Riyadh';
        v_partner int; v_id int; v_no text; v_svc int := 0;
BEGIN
  PERFORM set_config('erpx.user','online',true);
  SELECT * INTO s FROM stores WHERE slug = p_slug AND is_active;
  SELECT * INTO w FROM store_site WHERE store_id = s.id AND is_published;
  IF s.id IS NULL OR w.store_id IS NULL OR NOT ('booking' = ANY (s.features)) THEN RAISE EXCEPTION 'ERPX-K020: bookings are not open for this store'; END IF;
  IF length(coalesce(v_name,'')) < 2 OR v_phone !~ '^\+?[0-9]{9,14}$' THEN RAISE EXCEPTION 'ERPX-K021: customer name and a valid phone are required'; END IF;
  SELECT c.id INTO v_city FROM sa_cities c JOIN sa_regions rg ON rg.id = c.region_id WHERE c.name_ar = p_customer->>'city' AND rg.name_ar = p_customer->>'region' AND c.is_active;
  SELECT id INTO v_dist FROM sa_districts WHERE city_id = v_city AND name_ar = p_customer->>'district';
  IF v_city IS NULL OR v_dist IS NULL THEN RAISE EXCEPTION 'ERPX-K022: choose region, city and district from the lists'; END IF;
  IF length(coalesce(btrim(p_customer->>'street'),'')) < 2 THEN RAISE EXCEPTION 'ERPX-K023: street is required'; END IF;
  v_at := ((p_when->>'date') || ' ' || (p_when->>'time'))::timestamp;
  IF v_at < v_now + interval '2 hours' OR v_at > v_now + interval '90 days' THEN RAISE EXCEPTION 'ERPX-K024: appointment must be between 2 hours and 90 days from now'; END IF;
  IF v_at::time < '08:00' OR v_at::time > '20:30' OR extract(minute FROM v_at)::int NOT IN (0,30) THEN RAISE EXCEPTION 'ERPX-K025: working hours are 08:00-20:30 in 30-minute slots'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'ERPX-K026: choose 1 to 10 items'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (l->>'qty')::int; IF v_qty NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'ERPX-K026: quantity/days must be 1..60'; END IF;
    SELECT * INTO p FROM products WHERE id = (l->>'product_id')::int AND is_active AND published AND kind IN ('service','rental','goods') FOR UPDATE;
    IF p.id IS NULL THEN RAISE EXCEPTION 'ERPX-K027: item % is not available for a service request', l->>'product_id'; END IF;
    IF p.kind = 'goods' THEN   -- product add-on: must be in stock (checked here, deducted when the request is invoiced)
      IF p.stock_tracked AND NOT p.allow_negative AND fn_available(p.id, s.id) < v_qty THEN RAISE EXCEPTION 'ERPX-K028: product % is out of stock or the quantity is not available', p.name_ar; END IF;
    ELSE v_svc := v_svc + 1; END IF;
    v_disc := round(v_qty * fn_unit_discount(p.id, s.id, v_now::date), 2); v_net := round(v_qty * p.sale_price - v_disc, 2);
    SELECT rate INTO v_rate FROM tax_codes WHERE code = p.tax_code; v_vat := round(v_net * v_rate / 100, 2);
    v_rows := v_rows || jsonb_build_object('product_id',p.id,'description',p.name_ar,'qty',v_qty,'unit_price',p.sale_price,'discount',v_disc,'tax_code',p.tax_code,'net',v_net,'vat',v_vat,
              'revenue_account',(SELECT code FROM accounts WHERE id = p.revenue_account_id));
    v_sub := v_sub + v_net; v_tv := v_tv + v_vat;
  END LOOP;
  IF v_svc = 0 THEN RAISE EXCEPTION 'ERPX-K029: choose at least one service or rental (products can only be added to it)'; END IF;
  SELECT id INTO v_partner FROM partners WHERE phone = v_phone AND kind = 'customer' ORDER BY id LIMIT 1;
  IF v_partner IS NULL THEN INSERT INTO partners(kind,name_ar,phone,city,district,street,building_no,postal_code) VALUES ('customer',v_name,v_phone,(SELECT name_ar FROM sa_cities WHERE id=v_city),p_customer->>'district',left(p_customer->>'street',120),left(p_customer->>'building_no',10),left(p_customer->>'postal_code',10)) RETURNING id INTO v_partner; END IF;
  v_no := 'BK-' || to_char(v_now,'YYYY') || '-' || lpad(next_number('BK-' || to_char(v_now,'YYYY'))::text, 6, '0');
  INSERT INTO bookings(number,store_id,customer_name,phone,email,city_id,district_id,street,building_no,postal_code,address_notes,scheduled_at,partner_id,subtotal,vat_amount,total,notes,
                       buyer_name,bill_building_no,bill_street,bill_district,bill_city,bill_postal_code)
  VALUES (v_no,s.id,v_name,v_phone,left(p_customer->>'email',120),v_city,v_dist,left(p_customer->>'street',120),left(p_customer->>'building_no',10),left(p_customer->>'postal_code',10),left(p_customer->>'address_notes',250),
          v_at,v_partner,v_sub,v_tv,v_sub+v_tv,left(p_customer->>'notes',500),v_name,left(p_customer->>'building_no',10),left(p_customer->>'street',120),p_customer->>'district',(SELECT name_ar FROM sa_cities WHERE id=v_city),left(p_customer->>'postal_code',10))
  RETURNING id INTO v_id;
  INSERT INTO booking_lines(booking_id,product_id,description,qty,unit_price,discount,tax_code,net,vat,revenue_account)
  SELECT v_id,r.product_id,r.description,r.qty,r.unit_price,r.discount,r.tax_code,r.net,r.vat,r.revenue_account
  FROM jsonb_to_recordset(v_rows) AS r(product_id int,description text,qty numeric,unit_price numeric,discount numeric,tax_code text,net numeric,vat numeric,revenue_account text);
  RETURN QUERY SELECT v_no, v_sub + v_tv;
END $$;

INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES ('schema', '{"version": "0.8.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
