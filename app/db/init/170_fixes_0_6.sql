-- 170: 0.6.0. Idempotent; safe on a new AND on an upgraded database. Marks schema 0.6.0.
-- (0.6.0 changes are in the application layer: automatic migration, storefront robustness, clear "database outdated" errors.)
INSERT INTO app_settings(key, value) VALUES ('schema', '{"version":"0.6.0"}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
