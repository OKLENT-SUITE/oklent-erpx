// One boolean probe per db/init/*.sql file: "is this file's effect already in the database?"  Used by the migration runner (migrate.js)
// and by GET /api/diagnostics. `full` = completely applied. `partial` (optional) = some of its objects exist (=> the database is in a state we
// cannot repair automatically, e.g. an older variant of the same file).
const T = (...names) => names.map(n => `to_regclass('public.${n}') IS NOT NULL`).join(' AND ');
const ANY = (...names) => names.map(n => `to_regclass('public.${n}') IS NOT NULL`).join(' OR ');
const COL = (t, c) => `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' AND column_name='${c}')`;
const FN = (sig) => `to_regprocedure('public.${sig}') IS NOT NULL`;
const VER = `(SELECT string_to_array(value->>'version','.')::int[] FROM public.app_settings WHERE key='schema')`;

export const PROBES = [
  { file: '010_core.sql', full: T('company', 'journal_entries', 'journal_lines', 'accounts', 'fiscal_periods'), partial: ANY('company', 'journal_entries', 'accounts') },
  { file: '020_property_invoicing.sql', full: T('invoices', 'invoice_lines', 'leases', 'rent_schedule', 'properties', 'units'), partial: ANY('invoices', 'leases', 'properties') },
  { file: '030_rules.sql', full: FN('forbid_mutation()') + ' AND ' + FN('je_before_insert()') },
  { file: '040_functions.sql', full: FN('post_entry(date,text,text,text,text,text,jsonb,bigint)') + ' AND ' + FN('record_invoice(jsonb,jsonb)') },
  { file: '050_reports.sql', full: FN('fn_trial_balance(date,date)') + ' AND ' + FN('fn_daybook(date,date)') + ' AND ' + FN('fn_balance_sheet(date)') },
  { file: '060_seed.sql', full: 'EXISTS (SELECT 1 FROM public.currencies) AND EXISTS (SELECT 1 FROM public.accounts)' },
  { file: '070_privileges.sql', full: "EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erpx_app') AND has_table_privilege('erpx_app','public.journal_entries','SELECT')" },
  { file: '080_rules_lab.sql', full: FN('rules_lab(text)') },
  { file: '100_commerce.sql', full: T('stores', 'store_site', 'products', 'offers', 'bank_transfers', 'online_orders', 'online_order_lines') + ' AND ' + FN('place_online_order(text,jsonb,jsonb,text,text)'), partial: ANY('stores', 'products', 'online_orders') },
  { file: '110_purchases.sql', full: T('vendor_bills', 'vendor_payments'), partial: ANY('vendor_bills', 'vendor_payments') },
  { file: '120_platform.sql', full: T('sa_regions', 'sa_cities', 'sa_districts', 'unit_types', 'owners', 'property_ownership', 'technicians', 'bookings', 'booking_lines', 'stock_moves') + ' AND ' + COL('sa_cities', 'region_id') + ' AND ' + COL('products', 'allow_negative') + ' AND ' + FN('fn_available(integer,integer)'),
    partial: ANY('sa_regions', 'sa_cities', 'technicians', 'bookings', 'stock_moves', 'owners') },
  { file: '125_geo_saudi.sql', full: '(SELECT count(*) FROM public.sa_regions) >= 13 AND ' + COL('sa_cities', 'needs_review'),
    // replacing the geography is refused once bookings reference it; the new column is still added so the screens work
    skipIf: 'EXISTS (SELECT 1 FROM public.bookings)', skipDo: 'ALTER TABLE public.sa_cities ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false' },
  { file: '130_demo_catalog.sql', full: 'EXISTS (SELECT 1 FROM public.products)' },
  { file: '140_menu_settings.sql', full: T('app_settings') + " AND EXISTS (SELECT 1 FROM public.app_settings WHERE key='menu')", partial: ANY('app_settings') },
  { file: '150_schema_version.sql', full: "EXISTS (SELECT 1 FROM public.app_settings WHERE key='schema')" },
  { file: '160_fixes_0_5.sql', full: `${VER} >= ARRAY[0,5,0]` },
  { file: '200_inventory_costing_invoice_lines.sql', full: T('product_costing') + ' AND ' + COL('invoice_lines', 'period_from') + ' AND ' + COL('stock_moves', 'unit_cost') + ' AND ' + FN('receive_stock(integer,integer,numeric,numeric,date,text,text,text,integer,numeric,date,text)') + ' AND ' + FN('post_invoice_stock(bigint,integer,text)') },
  { file: '210_idempotency.sql', full: T('idempotency_keys') },
  { file: '250_stock_valuation_repair.sql', full: T('stock_valuation_events') + ' AND ' + FN('set_stock_initial_cost(integer,numeric,text,text)') },
  { file: '260_stock_valuation_60pct.sql', full: T('stock_valuation_events') + " AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_valuation_events'::regclass AND pg_get_constraintdef(oid) LIKE '%estimated_60pct%')" },
];

/** Evaluate a probe with any client; a probe that errors (missing table etc.) counts as "false". */
export async function runProbe(client, sql) {
  try { const { rows: [r] } = await client.query(`SELECT coalesce((${sql}),false) AS ok`); return r.ok === true; } catch { try { await client.query('ROLLBACK'); } catch {} return false; }
}
