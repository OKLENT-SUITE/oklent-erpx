-- 020: property management + e-invoicing tables
CREATE TABLE tax_codes (
  code text PRIMARY KEY, name_ar text NOT NULL, name_en text NOT NULL,
  rate numeric(5,2) NOT NULL CHECK (rate >= 0), category text NOT NULL CHECK (category IN ('S','Z','E','O')),
  CHECK ((category = 'S') = (rate > 0))
);

CREATE TABLE properties (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, name_ar text NOT NULL, name_en text,
  kind text NOT NULL CHECK (kind IN ('residential','commercial')),
  city text, district text, deed_no text, branch_id int REFERENCES branches,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE units (
  id serial PRIMARY KEY, property_id int NOT NULL REFERENCES properties,
  unit_no text NOT NULL, kind text, area_m2 numeric(10,2) CHECK (area_m2 > 0),
  base_annual_rent numeric(20,2) CHECK (base_annual_rent >= 0),
  UNIQUE (property_id, unit_no)
);
CREATE TABLE leases (
  id serial PRIMARY KEY, number text UNIQUE NOT NULL,
  unit_id int NOT NULL REFERENCES units, tenant_id int NOT NULL REFERENCES partners,
  start_date date NOT NULL, end_date date NOT NULL, CHECK (end_date > start_date),
  annual_rent numeric(20,2) NOT NULL CHECK (annual_rent > 0),
  payment_freq text NOT NULL CHECK (payment_freq IN ('monthly','quarterly','semiannual','annual')),
  vat_applicable boolean NOT NULL DEFAULT false,      -- commercial lease = 15%; residential = exempt
  deposit numeric(20,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  ejar_contract_no text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','terminated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&) WHERE (status = 'active')
);

CREATE TABLE invoices (
  id bigserial PRIMARY KEY,
  number text UNIQUE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('standard','simplified','credit','debit')),  -- 388 / 388 / 381 / 383
  issue_at timestamptz NOT NULL, supply_date date NOT NULL, due_date date,
  partner_id int REFERENCES partners,
  subtotal numeric(20,2) NOT NULL, vat_amount numeric(20,2) NOT NULL, total numeric(20,2) NOT NULL,
  related_invoice_id bigint REFERENCES invoices, reason text,
  branch_id int REFERENCES branches, lease_id int REFERENCES leases, rent_schedule_id int,
  entry_id bigint REFERENCES journal_entries,
  uuid uuid NOT NULL UNIQUE, icv bigint NOT NULL UNIQUE, pih text NOT NULL,
  invoice_hash text NOT NULL UNIQUE, qr text NOT NULL, xml text NOT NULL,
  issued_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total = subtotal + vat_amount),
  CHECK (kind NOT IN ('credit','debit') OR (related_invoice_id IS NOT NULL AND length(btrim(coalesce(reason,''))) >= 3)),
  CHECK (kind <> 'standard' OR partner_id IS NOT NULL)      -- B2B must identify the buyer
);
CREATE TABLE invoice_lines (
  id bigserial PRIMARY KEY, invoice_id bigint NOT NULL REFERENCES invoices, line_no smallint NOT NULL,
  description text NOT NULL, qty numeric(20,4) NOT NULL CHECK (qty > 0),
  unit_price numeric(20,4) NOT NULL CHECK (unit_price >= 0), discount numeric(20,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_code text NOT NULL REFERENCES tax_codes, vat_rate numeric(5,2) NOT NULL,
  net numeric(20,2) NOT NULL, vat numeric(20,2) NOT NULL,
  revenue_account_id int NOT NULL REFERENCES accounts,
  UNIQUE (invoice_id, line_no)
);
CREATE TABLE invoice_payments (
  id bigserial PRIMARY KEY, invoice_id bigint NOT NULL REFERENCES invoices, entry_id bigint NOT NULL REFERENCES journal_entries,
  amount numeric(20,2) NOT NULL CHECK (amount > 0), paid_on date NOT NULL, method text, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rent_schedule (
  id serial PRIMARY KEY, lease_id int NOT NULL REFERENCES leases, seq smallint NOT NULL,
  due_date date NOT NULL, amount numeric(20,2) NOT NULL CHECK (amount > 0), vat_rate numeric(5,2) NOT NULL DEFAULT 0,
  invoice_id bigint REFERENCES invoices, UNIQUE (lease_id, seq)
);
ALTER TABLE invoices ADD FOREIGN KEY (rent_schedule_id) REFERENCES rent_schedule;
CREATE INDEX inv_partner_idx ON invoices (partner_id);
