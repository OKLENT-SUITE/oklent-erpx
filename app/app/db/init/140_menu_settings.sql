-- 140: application settings (menu visibility). Safe on an existing database: CREATE ... IF NOT EXISTS.
-- Visibility is a USER-INTERFACE preference only: it hides menu entries for everyone; permissions are still enforced by roles in the API.
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_by text, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO app_settings(key, value) VALUES ('menu', '{"disabled":["properties","owners"]}') ON CONFLICT (key) DO NOTHING;
DROP TRIGGER IF EXISTS r10_audit_app_settings ON app_settings;
CREATE TRIGGER r10_audit_app_settings AFTER INSERT OR UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION audit_trg();
GRANT SELECT, INSERT, UPDATE ON app_settings TO erpx_app;
