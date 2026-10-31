-- 150: schema marker. The API compares it with the version it expects and warns loudly when the database was built by an older package
-- (init scripts run only on the first start of a volume, so an old volume + new code gives confusing 500 errors).
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_by text, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO app_settings(key, value) VALUES ('schema', '{"version":"0.4.1"}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
GRANT SELECT ON app_settings TO erpx_app;
