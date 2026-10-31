-- 210 (schema 0.10.0): idempotency keys for financial / public write requests (T-07, ACC-02).
-- A client may send `Idempotency-Key: <8-100 chars>` on POST /api/invoices, POST /api/public/bookings and POST /api/public/orders.
-- The first request with a key executes; a retry (same key, same payload) returns the stored response instead of creating a second document;
-- the same key with a DIFFERENT payload is refused. Idempotent: safe to re-run (CREATE IF NOT EXISTS only).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope         text        NOT NULL,                       -- endpoint + caller (username or IP)
  key           text        NOT NULL CHECK (length(key) BETWEEN 8 AND 100),
  request_hash  text        NOT NULL,                       -- sha256 of the request body
  status        text        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','done')),
  response_code int,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO erpx_app;     -- bookkeeping only: it holds no ledger data and cannot change one

INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES ('schema', '{"version": "0.10.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
