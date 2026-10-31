-- 185_hr_grants.sql
-- OKLENT BUSINESS — Permissions on HR & Financial Modules

GRANT SELECT, INSERT, UPDATE, DELETE ON employees, payroll_runs, payroll_items, custodies, custody_settlements, expense_claims TO erpx_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erpx_app;
GRANT EXECUTE ON FUNCTION fn_post_payroll(int, text) TO erpx_app;
GRANT EXECUTE ON FUNCTION fn_pay_payroll(int, text, date, text) TO erpx_app;
GRANT EXECUTE ON FUNCTION fn_post_custody(int, text, text) TO erpx_app;
GRANT EXECUTE ON FUNCTION fn_settle_custody(int, text) TO erpx_app;
GRANT EXECUTE ON FUNCTION fn_post_expense_claim(int, text) TO erpx_app;

-- Update schema version
INSERT INTO app_settings(key, value, updated_by, updated_at)
VALUES ('schema', '{"version": "0.7.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value = '{"version": "0.7.0"}'::jsonb, updated_at = now();
