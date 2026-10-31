-- 070: least privilege. The API connects as erpx_app: it can READ everything, WRITE master data only,
-- and reaches the ledger exclusively through SECURITY DEFINER functions.
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='erpx_app') THEN CREATE ROLE erpx_app LOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO erpx_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO erpx_app;
REVOKE SELECT ON users FROM erpx_app;
GRANT SELECT (id,username,full_name,role,is_active) ON users TO erpx_app;
GRANT INSERT, UPDATE ON partners, accounts, properties, units, leases, branches TO erpx_app;
GRANT INSERT ON exchange_rates TO erpx_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erpx_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_entry, reverse_entry, close_period, reopen_period, lock_period, year_end_close, login_user,
  generate_rent_schedule, lock_invoice_chain, next_invoice_no, record_invoice, record_payment, verify_chain, fn_rate,
  fn_trial_balance, fn_income_statement, fn_balance_sheet, fn_general_ledger, fn_daybook, fn_vat_return, fn_ar_aging, fn_invoice_outstanding,
  zatca_genesis_pih TO erpx_app;
-- create_user() stays owner-only: users are created by the CLI/seed running as the owner.
