-- 060: reference data (Saudi COA, VAT codes, currencies, branches, periods). Demo transactions come from `npm run seed`.
INSERT INTO currencies(code,name_ar,name_en,decimals,is_base) VALUES
 ('SAR','ريال سعودي','Saudi Riyal',2,true),('USD','دولار أمريكي','US Dollar',2,false),
 ('EUR','يورو','Euro',2,false),('AED','درهم إماراتي','UAE Dirham',2,false);
INSERT INTO exchange_rates(currency_code,rate_date,rate) VALUES ('USD','2026-01-01',3.75),('AED','2026-01-01',1.0211),('EUR','2026-01-01',4.05);
INSERT INTO tax_codes VALUES
 ('S15','خاضع للضريبة 15%','Standard rate 15%',15,'S'),('Z0','خاضع لنسبة الصفر','Zero rated',0,'Z'),
 ('E','معفى (مثل الإيجار السكني)','Exempt (e.g. residential rent)',0,'E'),('O','خارج نطاق الضريبة','Out of scope',0,'O');
INSERT INTO company(name_ar,name_en,vat_number,cr_number,building_no,street,district,city,postal_code) VALUES
 ('شركة تجريبية (بيانات عرض)','Demo Company (sample data)','300000000000003','1010000000','1234','طريق الملك فهد','العليا','الرياض','12214');
INSERT INTO branches(code,name_ar,name_en,city) VALUES
 ('RYD','الرياض','Riyadh','Riyadh'),('JED','جدة','Jeddah','Jeddah'),('DMM','المنطقة الشرقية','Eastern Province','Dammam'),
 ('ABH','أبها','Abha','Abha'),('MED','المدينة المنورة','Madinah','Madinah');

-- Saudi chart of accounts (1 assets, 2 liabilities, 3 equity, 4 revenue, 5 expenses). Headers are non-postable.
CREATE TEMP TABLE coa(code text, ar text, en text, typ account_type, parent text, post boolean);
INSERT INTO coa VALUES
('1000','الأصول','Assets','asset',NULL,false),
('1100','الأصول المتداولة','Current assets','asset','1000',false),
('1110','النقدية بالصندوق','Cash on hand','asset','1100',true),
('1120','البنوك','Bank accounts','asset','1100',false),
('1121','البنك الأهلي - حساب جاري','Bank - current account','asset','1120',true),
('1122','شبكة مدى / بطاقات (قيد التحصيل)','Mada / cards clearing','asset','1120',true),
('1130','العملاء والمستأجرون (ذمم مدينة)','Accounts receivable','asset','1100',true),
('1140','المخزون','Inventory','asset','1100',true),
('1150','ضريبة القيمة المضافة - مدخلات','VAT input','asset','1100',true),
('1160','مصروفات مدفوعة مقدماً','Prepaid expenses','asset','1100',true),
('1200','الأصول الثابتة','Fixed assets','asset','1000',false),
('1210','أراضي ومباني','Land and buildings','asset','1200',true),
('1220','آلات ومعدات التشغيل','Plant and equipment','asset','1200',true),
('1230','ألعاب ومعدات التأجير','Rental toys and equipment','asset','1200',true),
('1290','مجمع الاستهلاك','Accumulated depreciation','asset','1200',true),
('2000','الخصوم','Liabilities','liability',NULL,false),
('2100','الخصوم المتداولة','Current liabilities','liability','2000',false),
('2110','ضريبة القيمة المضافة - مخرجات','VAT output','liability','2100',true),
('2120','الموردون (ذمم دائنة)','Accounts payable','liability','2100',true),
('2130','رواتب مستحقة','Accrued salaries','liability','2100',true),
('2140','إيرادات إيجار مقدمة','Unearned rent','liability','2100',true),
('2150','ودائع ضمان المستأجرين','Tenant security deposits','liability','2100',true),
('2160','التأمينات الاجتماعية (GOSI) مستحقة','GOSI payable','liability','2100',true),
('2200','خصوم طويلة الأجل','Non-current liabilities','liability','2000',false),
('2210','مخصص مكافأة نهاية الخدمة','End-of-service provision','liability','2200',true),
('2220','قروض طويلة الأجل','Long-term loans','liability','2200',true),
('3000','حقوق الملكية','Equity','equity',NULL,false),
('3100','رأس المال','Share capital','equity','3000',true),
('3200','الاحتياطي النظامي','Statutory reserve','equity','3000',true),
('3300','الأرباح المبقاة','Retained earnings','equity','3000',true),
('4000','الإيرادات','Revenue','revenue',NULL,false),
('4100','إيرادات الإيجار','Rental revenue','revenue','4000',true),
('4200','مبيعات الألعاب','Toy sales','revenue','4000',true),
('4300','خدمات الصيانة وما بعد البيع','After-sales and maintenance revenue','revenue','4000',true),
('4900','إيرادات أخرى','Other income','revenue','4000',true),
('5000','المصروفات','Expenses','expense',NULL,false),
('5100','تكلفة البضاعة المباعة','Cost of goods sold','expense','5000',true),
('5200','الرواتب والأجور','Salaries and wages','expense','5000',true),
('5210','التأمينات الاجتماعية (حصة المنشأة)','GOSI employer share','expense','5000',true),
('5300','إيجارات','Rent expense','expense','5000',true),
('5400','كهرباء ومياه واتصالات','Utilities and telecom','expense','5000',true),
('5500','صيانة وإصلاح','Repairs and maintenance','expense','5000',true),
('5600','تسويق وإعلان','Marketing','expense','5000',true),
('5700','الاستهلاك','Depreciation','expense','5000',true),
('5800','عمولات ورسوم بنكية','Bank charges and commissions','expense','5000',true),
('5900','فروقات العملة','FX gains and losses','expense','5000',true),
('5910','فروقات التقريب','Rounding differences','expense','5000',true),
('5950','مصروفات أخرى','Other expenses','expense','5000',true);
-- insert parents first (ordered by code length/level is already guaranteed by list order)
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM coa LOOP
    INSERT INTO accounts(code,name_ar,name_en,type,parent_id,is_postable) VALUES
      (r.code,r.ar,r.en,r.typ,(SELECT id FROM accounts WHERE code = r.parent),r.post);
  END LOOP; END $$;

-- 2026 + 2027 monthly periods
INSERT INTO fiscal_periods(name,fiscal_year,start_date,end_date)
SELECT to_char(d,'YYYY-MM'), extract(year FROM d)::int, d::date, (d + interval '1 month - 1 day')::date
FROM generate_series('2026-01-01'::date,'2027-12-01','1 month') d;
