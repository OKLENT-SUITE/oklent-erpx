-- Optional AI assistant audit trail. Prompts and model responses are intentionally never stored.
CREATE TABLE IF NOT EXISTS ai_audit (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  actor_id bigint REFERENCES users(id),
  feature text NOT NULL CHECK (feature IN ('documents','rule','invoice','report')),
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('started','succeeded','failed','blocked')),
  policy_decision text NOT NULL,
  prompt_chars int NOT NULL DEFAULT 0 CHECK (prompt_chars >= 0),
  input_tokens int CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens int CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_estimate_usd numeric(12,6) CHECK (cost_estimate_usd IS NULL OR cost_estimate_usd >= 0),
  duration_ms int CHECK (duration_ms IS NULL OR duration_ms >= 0),
  fail_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_audit_actor_date_idx ON ai_audit(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_audit_date_idx ON ai_audit(created_at DESC);
GRANT SELECT, INSERT, UPDATE ON ai_audit TO erpx_app;
GRANT USAGE, SELECT ON SEQUENCE ai_audit_id_seq TO erpx_app;
INSERT INTO app_settings(key, value, updated_by, updated_at)
VALUES ('schema', '{"version": "0.12.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at;
