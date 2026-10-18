-- 175: idempotent privilege repair (least privilege: erpx_app reads everything, writes master data only). Safe to re-run; run by the automatic upgrade.
-- A half-upgraded volume had tables created by hand as the owner WITHOUT these grants -> «permission denied for table sa_regions».
GRANT USAGE ON SCHEMA public TO erpx_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO erpx_app;
REVOKE SELECT ON users FROM erpx_app;
GRANT SELECT (id,username,full_name,role,is_active) ON users TO erpx_app;
GRANT INSERT, UPDATE ON partners, accounts, properties, units, leases, branches TO erpx_app;
GRANT INSERT ON exchange_rates TO erpx_app;
GRANT INSERT, UPDATE ON stores, store_site, products, offers TO erpx_app;
GRANT INSERT ON bank_transfers TO erpx_app;
GRANT INSERT, UPDATE ON sa_regions, sa_cities, sa_districts, owners, technicians TO erpx_app;
GRANT INSERT, UPDATE, DELETE ON property_ownership TO erpx_app;
GRANT SELECT, INSERT, UPDATE ON app_settings TO erpx_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erpx_app;
