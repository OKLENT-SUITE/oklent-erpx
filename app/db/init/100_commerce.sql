-- 100: stores, flexible commerce types, storefront settings, products/offers, bank transfers, online orders, user admin.
-- Safe to run on an existing database:  docker compose exec -T db psql -U erpx_owner -d erpx -v ON_ERROR_STOP=1 < db/init/100_commerce.sql
CREATE TABLE commerce_features (code text PRIMARY KEY, name_ar text NOT NULL, name_en text NOT NULL);
INSERT INTO commerce_features VALUES
 ('pos','نقاط البيع','Point of sale'),('online_shop','المتجر الإلكتروني','Online shop'),('rental','التأجير','Rental'),
 ('booking','الحجز','Booking'),('services','الخدمات والصيانة وما بعد البيع','Services & after-sales'),('wholesale','البيع بالجملة','Wholesale'),
 ('delivery','التوصيل','Delivery'),('subscriptions','الاشتراكات','Subscriptions'),('transfers','الحوالات البنكية','Bank transfers'),('inventory','المخزون','Inventory');

CREATE TABLE commerce_types (code text PRIMARY KEY, name_ar text NOT NULL, name_en text NOT NULL, description_ar text, default_features text[] NOT NULL);
INSERT INTO commerce_types VALUES
 ('retail','تجزئة','Retail','بيع للأفراد: نقاط بيع + متجر إلكتروني + توصيل','{pos,online_shop,delivery,inventory,transfers}'),
 ('wholesale','جملة (B2B)','Wholesale','بيع للشركات والتجار بفواتير ضريبية وحوالات','{wholesale,online_shop,inventory,transfers}'),
 ('rental','تأجير','Rental','تأجير ألعاب/معدات مع حجز وتسليم','{rental,booking,services,transfers}'),
 ('service','خدمات وصيانة','Services','صيانة وما بعد البيع وعقود خدمة','{services,booking,subscriptions,transfers}'),
 ('subscription','اشتراكات','Subscriptions','خدمات متكررة (مثل صيانة دورية/تنقية مياه)','{subscriptions,online_shop,services,transfers}'),
 ('hybrid','متعدد الأنشطة','Multi-activity','بيع + تأجير + خدمات + حجوزات','{pos,online_shop,rental,booking,services,delivery,inventory,transfers}');

CREATE TABLE stores (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,20}$'), slug text UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name_ar text NOT NULL, name_en text, branch_id int REFERENCES branches,
  commerce_type text NOT NULL REFERENCES commerce_types, features text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION stores_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.features) f WHERE f NOT IN (SELECT code FROM commerce_features)) THEN
    RAISE EXCEPTION 'ERPX-S001: unknown store feature in %', NEW.features; END IF;
  IF TG_OP = 'INSERT' AND cardinality(NEW.features) = 0 THEN
    SELECT default_features INTO NEW.features FROM commerce_types WHERE code = NEW.commerce_type; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER r11_stores_guard BEFORE INSERT OR UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION stores_guard();

CREATE TABLE store_site (
  store_id int PRIMARY KEY REFERENCES stores, title_ar text, tagline_ar text, about_ar text, return_policy_ar text,
  theme_color text NOT NULL DEFAULT '#14B8A6' CHECK (theme_color ~ '^#[0-9A-Fa-f]{6}$'),
  phone text, whatsapp text, email text, is_published boolean NOT NULL DEFAULT false,
  payment_methods text[] NOT NULL DEFAULT '{cod}' CHECK (payment_methods <@ ARRAY['cod','bank_transfer','mada','card']),
  delivery_fee numeric(20,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0), free_delivery_over numeric(20,2) CHECK (free_delivery_over >= 0),
  min_order numeric(20,2) NOT NULL DEFAULT 0 CHECK (min_order >= 0));

CREATE TABLE products (
  id serial PRIMARY KEY, sku text UNIQUE NOT NULL, name_ar text NOT NULL, name_en text,
  kind text NOT NULL DEFAULT 'goods' CHECK (kind IN ('goods','service','rental')), category text, unit text NOT NULL DEFAULT 'قطعة',
  sale_price numeric(20,2) NOT NULL CHECK (sale_price >= 0),            -- price EXCLUDING VAT
  cost_price numeric(20,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  tax_code text NOT NULL DEFAULT 'S15' REFERENCES tax_codes, revenue_account_id int REFERENCES accounts,
  stock_tracked boolean NOT NULL DEFAULT false, published boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  description_ar text, image_url text CHECK (image_url IS NULL OR image_url ~ '^(https://|/)'), created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION products_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revenue_account_id IS NULL THEN
    SELECT id INTO NEW.revenue_account_id FROM accounts WHERE code = CASE NEW.kind WHEN 'rental' THEN '4100' WHEN 'service' THEN '4300' ELSE '4200' END; END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.revenue_account_id AND type = 'revenue' AND is_postable) THEN
    RAISE EXCEPTION 'ERPX-S003: product revenue account must be a postable revenue account'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER r11_products_guard BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION products_guard();

CREATE TABLE offers (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, name_ar text NOT NULL, product_id int REFERENCES products, store_id int REFERENCES stores,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','amount')), value numeric(20,2) NOT NULL CHECK (value > 0),
  start_date date NOT NULL, end_date date NOT NULL, is_active boolean NOT NULL DEFAULT true,
  CHECK (end_date >= start_date), CHECK (discount_type <> 'percent' OR value <= 100));

-- best active per-unit discount (SAR, excl. VAT) for a product at a date
CREATE FUNCTION fn_unit_discount(p_product int, p_store int, p_date date) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(max(CASE o.discount_type WHEN 'percent' THEN round(p.sale_price * o.value / 100, 2) WHEN 'amount' THEN least(o.value, p.sale_price) ELSE 0 END), 0)
  FROM products p LEFT JOIN offers o ON o.is_active AND p_date BETWEEN o.start_date AND o.end_date
       AND (o.product_id IS NULL OR o.product_id = p.id) AND (o.store_id IS NULL OR o.store_id = p_store)
  WHERE p.id = p_product $$;

CREATE TABLE bank_transfers (
  id serial PRIMARY KEY, reference text NOT NULL, transfer_date date NOT NULL, partner_id int REFERENCES partners,
  amount numeric(20,2) NOT NULL CHECK (amount > 0), bank_account text NOT NULL DEFAULT '1121', note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','rejected')), invoice_id bigint REFERENCES invoices,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decided_by text, decided_at timestamptz,
  UNIQUE (reference, bank_account));
CREATE FUNCTION confirm_transfer(p_id int, p_invoice_id bigint, p_user text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t bank_transfers; i invoices; e bigint;
BEGIN
  PERFORM set_config('erpx.user', p_user, true);
  SELECT * INTO t FROM bank_transfers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR t.status <> 'pending' THEN RAISE EXCEPTION 'ERPX-T002: transfer not found or already decided'; END IF;
  SELECT * INTO i FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-T003: invoice not found'; END IF;
  IF t.partner_id IS NOT NULL AND i.partner_id IS NOT NULL AND t.partner_id <> i.partner_id THEN RAISE EXCEPTION 'ERPX-T001: transfer and invoice belong to different customers'; END IF;
  e := record_payment(p_invoice_id, t.amount, t.transfer_date, t.bank_account, 'bank transfer ' || t.reference, p_user);
  UPDATE bank_transfers SET status = 'matched', invoice_id = p_invoice_id, decided_by = p_user, decided_at = now() WHERE id = p_id;
  RETURN e;
END $$;
CREATE FUNCTION reject_transfer(p_id int, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('erpx.user', p_user, true);
  UPDATE bank_transfers SET status = 'rejected', note = coalesce(note || ' | ', '') || 'مرفوضة: ' || coalesce(p_reason, ''), decided_by = p_user, decided_at = now() WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-T002: transfer not found or already decided'; END IF;
END $$;

CREATE TABLE online_orders (
  id serial PRIMARY KEY, number text UNIQUE NOT NULL, store_id int NOT NULL REFERENCES stores, partner_id int REFERENCES partners,
  customer_name text NOT NULL, phone text NOT NULL, city text, address text, payment_method text NOT NULL, notes text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','fulfilled','cancelled')),
  subtotal numeric(20,2) NOT NULL, vat_amount numeric(20,2) NOT NULL, total numeric(20,2) NOT NULL CHECK (total = subtotal + vat_amount),
  invoice_id bigint REFERENCES invoices, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE online_order_lines (
  id serial PRIMARY KEY, order_id int NOT NULL REFERENCES online_orders, product_id int REFERENCES products, description text NOT NULL,
  qty numeric(20,4) NOT NULL CHECK (qty > 0), unit_price numeric(20,2) NOT NULL, discount numeric(20,2) NOT NULL DEFAULT 0,
  tax_code text NOT NULL REFERENCES tax_codes, net numeric(20,2) NOT NULL, vat numeric(20,2) NOT NULL, revenue_account text NOT NULL);
CREATE TRIGGER r11_order_lines_immutable BEFORE UPDATE OR DELETE ON online_order_lines FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE FUNCTION orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.number, OLD.store_id, OLD.subtotal, OLD.vat_amount, OLD.total, OLD.customer_name, OLD.phone) IS DISTINCT FROM
     (NEW.number, NEW.store_id, NEW.subtotal, NEW.vat_amount, NEW.total, NEW.customer_name, NEW.phone) THEN
    RAISE EXCEPTION 'ERPX-O001: order amounts and customer are frozen after placement'; END IF;
  IF OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN RAISE EXCEPTION 'ERPX-O002: order already invoiced'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status,NEW.status) IN (('new','confirmed'),('new','cancelled'),('confirmed','fulfilled'),('confirmed','cancelled'))) THEN
    RAISE EXCEPTION 'ERPX-O003: status % -> % is not allowed', OLD.status, NEW.status; END IF;
  IF NEW.status = 'cancelled' AND OLD.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'ERPX-O004: an invoiced order is cancelled with a credit note, not a status change'; END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;
CREATE TRIGGER r11_orders_guard BEFORE UPDATE ON online_orders FOR EACH ROW EXECUTE FUNCTION orders_guard();
CREATE FUNCTION no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ERPX-I001: % rows are never deleted', TG_TABLE_NAME USING ERRCODE='integrity_constraint_violation'; END $$;
CREATE TRIGGER r11_orders_nodel BEFORE DELETE ON online_orders FOR EACH ROW EXECUTE FUNCTION no_delete();
CREATE TRIGGER r11_transfers_nodel BEFORE DELETE ON bank_transfers FOR EACH ROW EXECUTE FUNCTION no_delete();

CREATE FUNCTION set_order_status(p_id int, p_status text, p_user text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM set_config('erpx.user', p_user, true); UPDATE online_orders SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-O005: order not found'; END IF; END $$;
CREATE FUNCTION link_order_invoice(p_id int, p_invoice bigint, p_user text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM set_config('erpx.user', p_user, true); UPDATE online_orders SET invoice_id = p_invoice WHERE id = p_id AND invoice_id IS NULL AND status <> 'cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-O002: order missing, cancelled or already invoiced'; END IF; END $$;

-- PUBLIC checkout. Prices, offers, VAT and delivery are computed HERE from the database: the browser never supplies a price.
CREATE FUNCTION place_online_order(p_slug text, p_customer jsonb, p_lines jsonb, p_payment text, p_notes text)
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

-- users administration (the API enforces the admin role; the DB enforces password policy and "never lock out the last admin")
CREATE FUNCTION admin_create_user(p_username text, p_password text, p_role text, p_full text, p_actor text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('erpx.user', p_actor, true);
  IF p_username !~ '^[a-zA-Z0-9._-]{3,32}$' THEN RAISE EXCEPTION 'ERPX-U003: username must be 3-32 letters/digits/._-'; END IF;
  IF length(p_password) < 10 OR p_password !~ '[A-Za-z]' OR p_password !~ '[0-9]' THEN RAISE EXCEPTION 'ERPX-U001: password needs 10+ characters with letters and digits'; END IF;
  RETURN create_user(p_username, p_password, p_role, p_full);
END $$;
CREATE FUNCTION change_password(p_username text, p_old text, p_new text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('erpx.user', p_username, true);
  IF length(p_new) < 10 OR p_new !~ '[A-Za-z]' OR p_new !~ '[0-9]' THEN RAISE EXCEPTION 'ERPX-U001: password needs 10+ characters with letters and digits'; END IF;
  UPDATE users SET pw_hash = crypt(p_new, gen_salt('bf',10)) WHERE username = p_username AND pw_hash = crypt(p_old, pw_hash) AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-U004: current password is wrong'; END IF;
END $$;
CREATE FUNCTION admin_set_user(p_id int, p_role text, p_active boolean, p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('erpx.user', p_actor, true);
  UPDATE users SET role = p_role, is_active = p_active WHERE id = p_id;
  IF NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND is_active) THEN RAISE EXCEPTION 'ERPX-U002: at least one active admin must remain'; END IF;
END $$;

-- audit + privileges
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['stores','store_site','products','offers'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trg()','r10_audit_'||t,t); END LOOP; END $$;
GRANT SELECT ON commerce_features, commerce_types, stores, store_site, products, offers, bank_transfers, online_orders, online_order_lines TO erpx_app;
GRANT INSERT, UPDATE ON stores, store_site, products, offers TO erpx_app;
GRANT INSERT ON bank_transfers TO erpx_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erpx_app;
REVOKE EXECUTE ON FUNCTION confirm_transfer, reject_transfer, set_order_status, link_order_invoice, place_online_order, admin_create_user, change_password, admin_set_user, fn_unit_discount FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_transfer, reject_transfer, set_order_status, link_order_invoice, place_online_order, admin_create_user, change_password, admin_set_user, fn_unit_discount TO erpx_app;

-- demo store (hybrid: sale + rental + services) — unpublished until an admin publishes it
INSERT INTO stores(code,slug,name_ar,name_en,branch_id,commerce_type) VALUES ('STORE-1','store','المتجر','Store',(SELECT id FROM branches WHERE code='RYD'),'hybrid');
INSERT INTO store_site(store_id,title_ar,tagline_ar,payment_methods,delivery_fee,free_delivery_over,min_order,phone,email)
 SELECT id,'المتجر','منتجات · خدمات · حجوزات','{cod,bank_transfer}',30,500,0,'0500000000',NULL FROM stores WHERE code='STORE-1';
