-- Organization preferences live in app_settings so existing accounting tables stay compatible.
ALTER TABLE company DROP CONSTRAINT IF EXISTS company_vat_number_check;
GRANT UPDATE (name_ar,name_en,vat_number,cr_number,building_no,street,district,city,postal_code,base_currency) ON company TO erpx_app;
GRANT UPDATE (is_base) ON currencies TO erpx_app;
INSERT INTO app_settings(key, value, updated_by, updated_at)
VALUES ('account_profile', '{"country_code":"SA","fiscal_start_month":1,"logo_data_url":null}'::jsonb, 'migration', now())
ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings(key, value, updated_by, updated_at)
VALUES ('schema', '{"version":"0.13.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now();
