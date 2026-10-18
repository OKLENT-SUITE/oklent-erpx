-- 121: idempotent REPAIR of the platform schema (everything 120_platform.sql creates). Safe on a fresh, a half-upgraded and a complete database.
-- Used by the automatic upgrade (api/src/migrate.js) when an older volume has only SOME of the platform objects (e.g. 125/130/160 were applied by hand
-- before 120). Never drops data: tables are IF NOT EXISTS, functions CREATE OR REPLACE, triggers are re-created, columns are added only when missing.

-- columns an older sample-geography schema may lack
-- ===== Saudi geography: 13 administrative regions -> cities -> districts =====
-- Data comes from the supplied workbook (db/init/125_geo_saudi.sql); every city also has the district "أخرى / غير مدرج" so a booking is never blocked.
CREATE TABLE IF NOT EXISTS sa_regions (id serial PRIMARY KEY, name_ar text UNIQUE NOT NULL, name_en text NOT NULL);
CREATE TABLE IF NOT EXISTS sa_cities (id serial PRIMARY KEY, region_id int NOT NULL REFERENCES sa_regions, name_ar text UNIQUE NOT NULL, name_en text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS sa_districts (id serial PRIMARY KEY, city_id int NOT NULL REFERENCES sa_cities, name_ar text NOT NULL, UNIQUE (city_id, name_ar));
-- data: db/init/125_geo_saudi.sql

-- ===== property management: unit types (Ejar list), owners, ownership =====
ALTER TABLE sa_regions ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE sa_cities ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE sa_cities ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE sa_cities ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS unit_types (code text PRIMARY KEY, name_ar text NOT NULL, sort smallint NOT NULL);
INSERT INTO unit_types VALUES ('villa','فيلا',1),('floor','دور',2),('apartment','شقة',3),('duplex','شقة ثنائية الدور (دوبلكس)',4),('studio','شقة صغيرة (استوديو)',5),
 ('annex_apartment','شقة ملحق',6),('building','عمارة',7),('tower','برج',8),('apartment_upper_annex','شقة وملحق علوي',9),('floor_upper_annex','دور وملحق علوي',10),
 ('roof_villa','فيلا سطح',11),('driver_room','غرفة سائق',12),('resthouse','استراحة',13),('farm','مزرعة',14)
 ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar, sort = EXCLUDED.sort;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='units' AND column_name='unit_type') THEN
    ALTER TABLE units ADD COLUMN unit_type text REFERENCES unit_types;
    UPDATE units SET unit_type = 'apartment';
    ALTER TABLE units ALTER COLUMN unit_type SET NOT NULL; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='units' AND column_name='kind') THEN
    ALTER TABLE units DROP COLUMN kind; END IF; END $$;
COMMENT ON COLUMN units.unit_no IS 'Rental unit number as registered on the Ejar network';

CREATE TABLE IF NOT EXISTS owners (
  id serial PRIMARY KEY, kind text NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual','company')),
  name_ar text NOT NULL, name_en text, national_id text, cr_number text, vat_number text CHECK (vat_number ~ '^3[0-9]{13}3$'),
  phone text, email text, iban text CHECK (iban ~ '^SA[0-9]{22}$'), address text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS property_ownership (
  property_id int NOT NULL REFERENCES properties, owner_id int NOT NULL REFERENCES owners,
  share_pct numeric(5,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100), PRIMARY KEY (property_id, owner_id));
CREATE OR REPLACE FUNCTION ownership_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT coalesce(sum(share_pct),0) FROM property_ownership WHERE property_id = NEW.property_id) > 100 THEN
    RAISE EXCEPTION 'ERPX-W001: ownership shares of property % exceed 100%%', NEW.property_id; END IF; RETURN NULL; END $$;
DROP TRIGGER IF EXISTS r13_ownership_total ON property_ownership;
CREATE CONSTRAINT TRIGGER r13_ownership_total AFTER INSERT OR UPDATE ON property_ownership DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ownership_check();

-- ===== technicians & bookings =====
CREATE TABLE IF NOT EXISTS technicians (
  id serial PRIMARY KEY, name_ar text NOT NULL, phone text NOT NULL, city_id int REFERENCES sa_cities, branch_id int REFERENCES branches,
  specialty text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS bookings (
  id serial PRIMARY KEY, number text UNIQUE NOT NULL, store_id int NOT NULL REFERENCES stores,
  customer_name text NOT NULL, phone text NOT NULL, email text,
  city_id int NOT NULL REFERENCES sa_cities, district_id int NOT NULL REFERENCES sa_districts, street text, building_no text, postal_code text, address_notes text,
  scheduled_at timestamp NOT NULL,                                   -- local Saudi time (UTC+3, no DST)
  duration_minutes int NOT NULL DEFAULT 120 CHECK (duration_minutes BETWEEN 30 AND 720),
  scheduled_end timestamp GENERATED ALWAYS AS (scheduled_at + make_interval(mins => duration_minutes)) STORED,
  technician_id int REFERENCES technicians,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','in_progress','completed','cancelled')),
  -- data required to issue a (standard) tax invoice
  buyer_name text, buyer_vat text CHECK (buyer_vat ~ '^3[0-9]{13}3$'), buyer_cr text,
  bill_building_no text, bill_street text, bill_district text, bill_city text, bill_postal_code text,
  partner_id int REFERENCES partners, invoice_id bigint REFERENCES invoices,
  subtotal numeric(20,2) NOT NULL, vat_amount numeric(20,2) NOT NULL, total numeric(20,2) NOT NULL CHECK (total = subtotal + vat_amount),
  notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (technician_id WITH =, tsrange(scheduled_at, scheduled_end) WITH &&) WHERE (technician_id IS NOT NULL AND status IN ('confirmed','in_progress')));
CREATE TABLE IF NOT EXISTS booking_lines (
  id serial PRIMARY KEY, booking_id int NOT NULL REFERENCES bookings, product_id int REFERENCES products, description text NOT NULL,
  qty numeric(20,4) NOT NULL CHECK (qty > 0), unit_price numeric(20,2) NOT NULL, discount numeric(20,2) NOT NULL DEFAULT 0,
  tax_code text NOT NULL REFERENCES tax_codes, net numeric(20,2) NOT NULL, vat numeric(20,2) NOT NULL, revenue_account text NOT NULL);
DROP TRIGGER IF EXISTS r14_booking_lines_immutable ON booking_lines;
CREATE TRIGGER r14_booking_lines_immutable BEFORE UPDATE OR DELETE ON booking_lines FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS r14_bookings_nodel ON bookings;
CREATE TRIGGER r14_bookings_nodel BEFORE DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION no_delete();

CREATE OR REPLACE FUNCTION bookings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.number, OLD.store_id, OLD.subtotal, OLD.vat_amount, OLD.total, OLD.customer_name, OLD.phone, OLD.city_id, OLD.district_id)
     IS DISTINCT FROM (NEW.number, NEW.store_id, NEW.subtotal, NEW.vat_amount, NEW.total, NEW.customer_name, NEW.phone, NEW.city_id, NEW.district_id) THEN
    RAISE EXCEPTION 'ERPX-K010: booking amounts, customer and location are frozen after placement'; END IF;
  IF OLD.invoice_id IS NOT NULL AND (NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.status <> OLD.status OR
     (OLD.buyer_name,OLD.buyer_vat,OLD.bill_street,OLD.bill_city) IS DISTINCT FROM (NEW.buyer_name,NEW.buyer_vat,NEW.bill_street,NEW.bill_city)) THEN
    RAISE EXCEPTION 'ERPX-K011: an invoiced booking is frozen'; END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status,NEW.status) IN (('new','confirmed'),('new','cancelled'),('confirmed','in_progress'),('confirmed','completed'),('confirmed','cancelled'),('in_progress','completed'),('in_progress','cancelled'))) THEN
      RAISE EXCEPTION 'ERPX-K012: booking status % -> % is not allowed', OLD.status, NEW.status; END IF;
    IF NEW.status IN ('confirmed','in_progress','completed') AND NEW.technician_id IS NULL THEN RAISE EXCEPTION 'ERPX-K013: assign a technician before %', NEW.status; END IF;
  END IF;
  IF NEW.invoice_id IS NOT NULL AND OLD.invoice_id IS NULL AND NEW.status <> 'completed' THEN RAISE EXCEPTION 'ERPX-K014: only a completed booking can be invoiced'; END IF;
  IF NEW.technician_id IS DISTINCT FROM OLD.technician_id AND OLD.status NOT IN ('new','confirmed') THEN RAISE EXCEPTION 'ERPX-K015: technician cannot change once work started'; END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS r14_bookings_guard ON bookings;
CREATE TRIGGER r14_bookings_guard BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_guard();

-- ===== stock ledger (quantities only: no valuation / COGS yet) =====
ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_negative boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS stock_moves (
  id bigserial PRIMARY KEY, product_id int NOT NULL REFERENCES products, store_id int NOT NULL REFERENCES stores,
  qty numeric(20,4) NOT NULL CHECK (qty <> 0), kind text NOT NULL CHECK (kind IN ('opening','receipt','sale','sale_return','adjustment')),
  ref text, note text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS stock_moves_idx ON stock_moves (product_id, store_id);
DROP TRIGGER IF EXISTS r15_stock_moves_immutable ON stock_moves;
CREATE TRIGGER r15_stock_moves_immutable BEFORE UPDATE OR DELETE ON stock_moves FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS r15_stock_moves_trunc ON stock_moves;
CREATE TRIGGER r15_stock_moves_trunc BEFORE TRUNCATE ON stock_moves FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE OR REPLACE FUNCTION fn_on_hand(p_product int, p_store int) RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT coalesce(sum(qty),0) FROM stock_moves WHERE product_id = p_product AND store_id = p_store $$;
CREATE OR REPLACE FUNCTION fn_reserved(p_product int, p_store int) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(l.qty),0) FROM online_order_lines l JOIN online_orders o ON o.id = l.order_id
  WHERE l.product_id = p_product AND o.store_id = p_store AND o.status IN ('new','confirmed') AND o.invoice_id IS NULL $$;
CREATE OR REPLACE FUNCTION fn_available(p_product int, p_store int) RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT fn_on_hand(p_product,p_store) - fn_reserved(p_product,p_store) $$;
CREATE OR REPLACE FUNCTION stock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products;
BEGIN
  SELECT * INTO p FROM products WHERE id = NEW.product_id FOR UPDATE;       -- serialises concurrent movements of the same product
  IF NOT p.stock_tracked THEN RAISE EXCEPTION 'ERPX-K003: product % does not track stock', p.sku; END IF;
  IF NEW.qty < 0 AND NOT p.allow_negative AND fn_on_hand(NEW.product_id, NEW.store_id) + NEW.qty < 0 THEN
    RAISE EXCEPTION 'ERPX-K001: insufficient stock for % (on hand %, requested %)', p.sku, fn_on_hand(NEW.product_id, NEW.store_id), -NEW.qty; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS r15_stock_guard ON stock_moves;
CREATE TRIGGER r15_stock_guard BEFORE INSERT ON stock_moves FOR EACH ROW EXECUTE FUNCTION stock_guard();
CREATE OR REPLACE FUNCTION stock_move(p_product int, p_store int, p_qty numeric, p_kind text, p_ref text, p_note text, p_user text) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO stock_moves(product_id,store_id,qty,kind,ref,note,created_by) VALUES (p_product,p_store,p_qty,p_kind,p_ref,p_note,p_user) RETURNING id $$;

-- ===== public booking (prices computed here; geography validated against sa_cities/sa_districts) =====
CREATE OR REPLACE FUNCTION place_booking(p_slug text, p_customer jsonb, p_when jsonb, p_lines jsonb)
RETURNS TABLE(number text, total numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s stores; w store_site; l jsonb; p products; v_qty int; v_disc numeric; v_net numeric; v_vat numeric; v_rate numeric; v_sub numeric := 0; v_tv numeric := 0; v_rows jsonb := '[]';
        v_name text := btrim(p_customer->>'name'); v_phone text := btrim(p_customer->>'phone'); v_city int; v_dist int; v_at timestamp; v_now timestamp := now() AT TIME ZONE 'Asia/Riyadh';
        v_partner int; v_id int; v_no text;
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
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'ERPX-K026: choose 1 to 10 services'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (l->>'qty')::int; IF v_qty NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'ERPX-K026: quantity/days must be 1..60'; END IF;
    SELECT * INTO p FROM products WHERE id = (l->>'product_id')::int AND is_active AND published AND kind IN ('service','rental');
    IF p.id IS NULL THEN RAISE EXCEPTION 'ERPX-K027: service % is not available for booking', l->>'product_id'; END IF;
    v_disc := round(v_qty * fn_unit_discount(p.id, s.id, v_now::date), 2); v_net := round(v_qty * p.sale_price - v_disc, 2);
    SELECT rate INTO v_rate FROM tax_codes WHERE code = p.tax_code; v_vat := round(v_net * v_rate / 100, 2);
    v_rows := v_rows || jsonb_build_object('product_id',p.id,'description',p.name_ar,'qty',v_qty,'unit_price',p.sale_price,'discount',v_disc,'tax_code',p.tax_code,'net',v_net,'vat',v_vat,
              'revenue_account',(SELECT code FROM accounts WHERE id = p.revenue_account_id));
    v_sub := v_sub + v_net; v_tv := v_tv + v_vat;
  END LOOP;
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

CREATE OR REPLACE FUNCTION assign_booking(p_id int, p_tech int, p_at timestamp, p_minutes int, p_user text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings;
BEGIN
  PERFORM set_config('erpx.user', p_user, true);
  SELECT * INTO b FROM bookings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-K030: booking not found'; END IF;
  IF b.status NOT IN ('new','confirmed') THEN RAISE EXCEPTION 'ERPX-K031: only a new/confirmed booking can be (re)assigned'; END IF;
  IF NOT EXISTS (SELECT 1 FROM technicians WHERE id = p_tech AND is_active) THEN RAISE EXCEPTION 'ERPX-K032: technician not found or inactive'; END IF;
  IF p_at < (now() AT TIME ZONE 'Asia/Riyadh') THEN RAISE EXCEPTION 'ERPX-K033: schedule cannot be in the past'; END IF;
  -- status stays 'new' while the technician is set, then moves to 'confirmed' (the overlap rule applies to confirmed work)
  UPDATE bookings SET technician_id = p_tech, scheduled_at = p_at, duration_minutes = coalesce(p_minutes, duration_minutes) WHERE id = p_id;
  IF b.status = 'new' THEN UPDATE bookings SET status = 'confirmed' WHERE id = p_id; ELSE UPDATE bookings SET status = status WHERE id = p_id; END IF;
END $$;
CREATE OR REPLACE FUNCTION set_booking_status(p_id int, p_status text, p_user text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM set_config('erpx.user', p_user, true); UPDATE bookings SET status = p_status WHERE id = p_id; IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-K030: booking not found'; END IF; END $$;
CREATE OR REPLACE FUNCTION update_booking_billing(p_id int, p_j jsonb, p_user text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('erpx.user', p_user, true);
  UPDATE bookings SET buyer_name = nullif(btrim(p_j->>'buyer_name'),''), buyer_vat = nullif(btrim(p_j->>'buyer_vat'),''), buyer_cr = nullif(btrim(p_j->>'buyer_cr'),''),
    bill_building_no = nullif(btrim(p_j->>'bill_building_no'),''), bill_street = nullif(btrim(p_j->>'bill_street'),''), bill_district = nullif(btrim(p_j->>'bill_district'),''),
    bill_city = nullif(btrim(p_j->>'bill_city'),''), bill_postal_code = nullif(btrim(p_j->>'bill_postal_code'),'') WHERE id = p_id AND invoice_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-K011: booking not found or already invoiced'; END IF;
END $$;
CREATE OR REPLACE FUNCTION link_booking_invoice(p_id int, p_invoice bigint, p_partner int, p_user text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM set_config('erpx.user', p_user, true); UPDATE bookings SET invoice_id = p_invoice, partner_id = coalesce(p_partner, partner_id) WHERE id = p_id AND invoice_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERPX-K011: booking not found or already invoiced'; END IF; END $$;

-- ===== audit + privileges =====
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['owners','technicians','property_ownership'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I','r10_audit_'||t,t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trg()','r10_audit_'||t,t); END LOOP; END $$;
GRANT SELECT ON sa_regions, sa_cities, sa_districts, unit_types, owners, property_ownership, technicians, bookings, booking_lines, stock_moves TO erpx_app;
GRANT INSERT, UPDATE ON sa_regions, sa_cities, sa_districts, owners, technicians TO erpx_app;
GRANT INSERT, UPDATE, DELETE ON property_ownership TO erpx_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erpx_app;
REVOKE EXECUTE ON FUNCTION fn_on_hand, fn_reserved, fn_available, stock_move, place_booking, assign_booking, set_booking_status, update_booking_billing, link_booking_invoice FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_on_hand, fn_reserved, fn_available, stock_move, place_booking, assign_booking, set_booking_status, update_booking_billing, link_booking_invoice TO erpx_app;
