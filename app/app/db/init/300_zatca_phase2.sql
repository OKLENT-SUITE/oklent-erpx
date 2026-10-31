-- 300 (schema 0.17.0): ZATCA phase 2 STORAGE (prepared; nothing is sent until ZATCA_ENABLED=1 and a CSID exists). Idempotent; per tenant schema.
-- Private keys and CSID secrets are stored ONLY in sealed form (AES-256-GCM, api/src/totp.js sealSecret) — never plain.
CREATE TABLE IF NOT EXISTS zatca_credentials (
  id               serial PRIMARY KEY,
  env              text NOT NULL CHECK (env IN ('sandbox','simulation','production')),
  status           text NOT NULL DEFAULT 'csr_generated' CHECK (status IN ('csr_generated','compliance_csid','production_csid','revoked')),
  csr_pem          text,
  private_key_enc  text NOT NULL,
  certificate_pem  text,
  csid_user        text,
  csid_secret_enc  text,
  request_id       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- one live credential per environment
CREATE UNIQUE INDEX IF NOT EXISTS zatca_one_live_credential ON zatca_credentials (env) WHERE status <> 'revoked';

CREATE TABLE IF NOT EXISTS zatca_submissions (
  id            bigserial PRIMARY KEY,
  invoice_id    bigint NOT NULL UNIQUE REFERENCES invoices(id),
  mode          text NOT NULL CHECK (mode IN ('reporting','clearance')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','accepted','warning','rejected','error')),
  attempts      int NOT NULL DEFAULT 0,
  invoice_hash  text,
  signed_xml    text,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX IF NOT EXISTS zatca_submissions_pending_idx ON zatca_submissions (status) WHERE status IN ('pending','error');
GRANT SELECT, INSERT, UPDATE ON zatca_credentials, zatca_submissions TO erpx_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erpx_app;
INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES ('schema', '{"version":"0.17.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = 'migration', updated_at = now();
