-- OKLENT-ERPX | MIT | OKLENT.NET
-- 010: core tables. Rules that PROTECT these tables live in 030_rules.sql.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE company (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),         -- single-row table
  name_ar text NOT NULL, name_en text NOT NULL,
  vat_number text CHECK (vat_number ~ '^3[0-9]{13}3$'),     -- KSA VAT no: 15 digits, starts+ends with 3
  cr_number text, building_no text, street text, district text, city text, postal_code text,
  base_currency char(3) NOT NULL DEFAULT 'SAR'
);

CREATE TABLE currencies (
  code char(3) PRIMARY KEY, name_ar text NOT NULL, name_en text NOT NULL,
  decimals smallint NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 4),
  is_base boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX one_base_currency ON currencies ((true)) WHERE is_base;

CREATE TABLE exchange_rates (            -- rate = base currency units per 1 foreign unit
  id bigserial PRIMARY KEY,
  currency_code char(3) NOT NULL REFERENCES currencies,
  rate_date date NOT NULL,
  rate numeric(20,10) NOT NULL CHECK (rate > 0),
  UNIQUE (currency_code, rate_date)
);

CREATE TABLE branches (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL,
  name_ar text NOT NULL, name_en text NOT NULL, city text, is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE users (
  id serial PRIMARY KEY, username text UNIQUE NOT NULL, full_name text,
  pw_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','accountant','cashier','viewer')),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE partners (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('customer','vendor','tenant')),
  name_ar text NOT NULL, name_en text,
  vat_number text CHECK (vat_number ~ '^3[0-9]{13}3$'),
  cr_number text, national_id text, phone text, email text,
  building_no text, street text, district text, city text, postal_code text,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE account_type AS ENUM ('asset','liability','equity','revenue','expense');
CREATE TABLE accounts (
  id serial PRIMARY KEY,
  code varchar(10) UNIQUE NOT NULL CHECK (code ~ '^[1-5][0-9]{3,9}$'),
  name_ar text NOT NULL, name_en text NOT NULL,
  type account_type NOT NULL,
  parent_id int REFERENCES accounts,
  is_postable boolean NOT NULL DEFAULT true,      -- header accounts are never postable
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT code_matches_type CHECK (
    (type='asset' AND code LIKE '1%') OR (type='liability' AND code LIKE '2%') OR
    (type='equity' AND code LIKE '3%') OR (type='revenue' AND code LIKE '4%') OR
    (type='expense' AND code LIKE '5%'))
);

CREATE TABLE fiscal_periods (
  id serial PRIMARY KEY, name text UNIQUE NOT NULL, fiscal_year int NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  closed_at timestamptz, closed_by text,
  CHECK (end_date >= start_date),
  EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)   -- no overlapping periods
);

CREATE TABLE sequences (name text PRIMARY KEY, last_value bigint NOT NULL DEFAULT 0);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor text,
  table_name text NOT NULL, op text NOT NULL, row_pk text, old_data jsonb, new_data jsonb
);

-- ===== THE LEDGER =====
CREATE TABLE journal_entries (
  id bigserial PRIMARY KEY,
  entry_no text UNIQUE NOT NULL,
  entry_date date NOT NULL,
  period_id int NOT NULL REFERENCES fiscal_periods,
  branch_id int REFERENCES branches,
  memo text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual',
  source_id text,
  reversal_of bigint UNIQUE REFERENCES journal_entries,   -- an entry can be reversed once
  total_base numeric(20,2) NOT NULL CHECK (total_base > 0),
  chain_no bigint NOT NULL UNIQUE,                        -- position in the hash chain, assigned under lock (id order can differ under concurrency)
  prev_hash text NOT NULL, row_hash text NOT NULL,        -- tamper-evident chain
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX je_date_idx ON journal_entries (entry_date);
CREATE INDEX je_period_idx ON journal_entries (period_id);

CREATE TABLE journal_lines (
  id bigserial PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES journal_entries,
  line_no smallint NOT NULL,
  account_id int NOT NULL REFERENCES accounts,
  partner_id int REFERENCES partners,
  branch_id int REFERENCES branches,
  memo text,
  currency_code char(3) NOT NULL REFERENCES currencies,
  amount_currency numeric(20,4) NOT NULL,                 -- signed: + debit / - credit, in line currency
  rate numeric(20,10) NOT NULL CHECK (rate > 0),
  debit numeric(20,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),    -- base currency
  credit numeric(20,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit = 0) <> (credit = 0)),                    -- exactly one side per line
  UNIQUE (entry_id, line_no)
);
CREATE INDEX jl_account_idx ON journal_lines (account_id, entry_id);
CREATE INDEX jl_partner_idx ON journal_lines (partner_id) WHERE partner_id IS NOT NULL;
