-- 130: demo catalogue for the generic store (goods with stock, rental, services bookable online), technicians, offer.
-- All sample data: replace from the Products / Stock screens.
INSERT INTO products(sku,name_ar,name_en,kind,category,unit,sale_price,cost_price,tax_code,stock_tracked,published,description_ar) VALUES
 ('DEMO-T01','سيارة تحكم عن بعد','Remote control car','goods','ألعاب','قطعة',120.00,70,'S15',true,true,'منتج تجريبي'),
 ('DEMO-T02','مكعبات تعليمية (100 قطعة)','Learning blocks (100 pcs)','goods','ألعاب','علبة',85.00,45,'S15',true,true,'منتج تجريبي'),
 ('DEMO-T03','دمية دب كبير','Large teddy bear','goods','ألعاب','قطعة',150.00,80,'S15',true,true,'منتج تجريبي'),
 ('DEMO-T04','طقم ألعاب خشبية','Wooden toy set','goods','ألعاب','طقم',200.00,110,'S15',true,true,'منتج تجريبي'),
 ('DEMO-T05','دراجة أطفال','Kids bicycle','goods','رياضة','قطعة',350.00,210,'S15',true,true,'منتج تجريبي'),
 ('DEMO-T06','خيمة أطفال','Kids tent','goods','رياضة','قطعة',180.00,95,'S15',true,true,'منتج تجريبي'),
 ('DEMO-T07','طاولة وكراسي أطفال','Kids table and chairs','goods','أثاث','طقم',260.00,140,'S15',true,true,'منتج تجريبي'),
 ('DEMO-T08','لعبة أحجية 500 قطعة','500-piece puzzle','goods','ألعاب','علبة',60.00,30,'S15',true,true,'منتج تجريبي'),
 ('DEMO-R01','تأجير نطيطة (يوم)','Bouncy castle rental (day)','rental','تأجير','يوم',300.00,0,'S15',false,true,'قابل للحجز عبر المتجر'),
 ('DEMO-R02','تأجير طاولات وكراسي (يوم)','Table and chairs rental (day)','rental','تأجير','يوم',150.00,0,'S15',false,true,'قابل للحجز عبر المتجر'),
 ('DEMO-S01','زيارة صيانة وما بعد البيع','After-sales maintenance visit','service','خدمات','زيارة',150.00,0,'S15',false,true,'فني يصل إلى موقعك'),
 ('DEMO-S02','تركيب وتشغيل','Installation and setup','service','خدمات','زيارة',200.00,0,'S15',false,true,'فني يصل إلى موقعك')
ON CONFLICT (sku) DO NOTHING;
INSERT INTO stock_moves(product_id,store_id,qty,kind,ref,note,created_by)
SELECT p.id, s.id, q.qty, 'opening', 'OPEN-DEMO', 'رصيد افتتاحي تجريبي', 'system'
FROM (VALUES ('DEMO-T01',80),('DEMO-T02',150),('DEMO-T03',60),('DEMO-T04',45),('DEMO-T05',30),('DEMO-T06',50),('DEMO-T07',40),('DEMO-T08',200)) q(sku,qty)
JOIN products p ON p.sku = q.sku CROSS JOIN (SELECT id FROM stores WHERE slug='store') s
WHERE NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.product_id = p.id AND m.kind = 'opening');
INSERT INTO offers(code,name_ar,product_id,discount_type,value,start_date,end_date)
SELECT 'DEMO10','خصم 10% على سيارة التحكم',id,'percent',10,'2026-01-01','2027-12-31' FROM products WHERE sku='DEMO-T01' ON CONFLICT (code) DO NOTHING;
INSERT INTO technicians(name_ar,phone,city_id,branch_id,specialty) VALUES
 ('فني تجريبي 1','0500000001',(SELECT id FROM sa_cities WHERE name_ar='الرياض'),(SELECT id FROM branches WHERE code='RYD'),'صيانة عامة'),
 ('فني تجريبي 2','0500000002',(SELECT id FROM sa_cities WHERE name_ar='جده'),(SELECT id FROM branches WHERE code='JED'),'تركيب وتشغيل'),
 ('فني تجريبي 3','0500000003',(SELECT id FROM sa_cities WHERE name_ar='الدمام'),(SELECT id FROM branches WHERE code='DMM'),'صيانة عامة');
UPDATE store_site SET is_published = true WHERE store_id = (SELECT id FROM stores WHERE slug='store');
