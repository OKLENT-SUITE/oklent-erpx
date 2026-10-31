-- 260: Apply the user-approved opening valuation rule to existing uncosted stock.
-- Cost basis is 60% of the pre-tax selling price. This changes current inventory valuation only;
-- historical stock movements and journals remain immutable.
ALTER TABLE stock_valuation_events DROP CONSTRAINT IF EXISTS stock_valuation_events_event_type_check;
ALTER TABLE stock_valuation_events ADD CONSTRAINT stock_valuation_events_event_type_check
  CHECK (event_type IN ('initial_cost', 'migration_cost', 'estimated_60pct'));

WITH changed AS (
  UPDATE product_costing c
     SET avg_cost = round(p.sale_price * 0.60, 4), updated_at = now()
    FROM products p
   WHERE p.id = c.product_id
     AND p.stock_tracked
     AND c.qty > 0
     AND c.avg_cost <= 0
     AND p.sale_price > 0
  RETURNING c.product_id, c.qty, c.avg_cost
)
INSERT INTO stock_valuation_events(product_id, quantity, previous_avg_cost, new_avg_cost, reference, event_type, actor)
SELECT product_id, qty, 0, avg_cost,
       'تقدير افتتاحي معتمد: 60% من سعر البيع بدون ضريبة', 'estimated_60pct', 'migration'
  FROM changed;

INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES ('schema', '{"version":"0.15.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now();
