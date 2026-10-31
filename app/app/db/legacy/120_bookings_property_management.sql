-- 120: OKLENT.NET bookings and property management enhancements
CREATE TABLE IF NOT EXISTS rental_unit_types (
  code text PRIMARY KEY, name_ar text NOT NULL, name_en text NOT NULL, is_active boolean NOT NULL DEFAULT true
);
INSERT INTO rental_unit_types(code,name_ar,name_en) VALUES
 ('apartment','شقة','Apartment'),('villa','فيلا','Villa'),('shop','محل تجاري','Retail shop'),
 ('office','مكتب','Office'),('warehouse','مستودع','Warehouse'),('showroom','معرض','Showroom'),
 ('land','أرض','Land'),('event_space','مساحة فعاليات','Event space'),('equipment','معدات/ألعاب','Equipment')
ON CONFLICT (code) DO NOTHING;
ALTER TABLE units ADD COLUMN IF NOT EXISTS unit_type text REFERENCES rental_unit_types(code);
ALTER TABLE units ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'available';
ALTER TABLE units ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_partner_id int REFERENCES partners;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_qty integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0);
CREATE TABLE IF NOT EXISTS rental_bookings (
 id bigserial PRIMARY KEY, number text UNIQUE NOT NULL,
 store_id int NOT NULL REFERENCES stores(id), product_id int REFERENCES products(id),
 partner_id int REFERENCES partners(id), customer_name text NOT NULL, phone text NOT NULL,
 region text NOT NULL, city text NOT NULL, district text NOT NULL, address text,
 service_date date NOT NULL, end_date date NOT NULL, CHECK(end_date >= service_date),
 quantity int NOT NULL DEFAULT 1 CHECK(quantity > 0),
 unit_price numeric(20,2) NOT NULL CHECK(unit_price >= 0),
 total numeric(20,2) NOT NULL CHECK(total >= 0),
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','confirmed','assigned','in_progress','completed','invoiced','cancelled')),
 technician text, notes text, invoice_id bigint REFERENCES invoices(id),
 collection_status text NOT NULL DEFAULT 'unpaid' CHECK(collection_status IN ('unpaid','partial','paid')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rental_bookings_status_date_idx ON rental_bookings(status, service_date);
CREATE INDEX IF NOT EXISTS rental_bookings_phone_idx ON rental_bookings(phone);
