## 1.5.0 — 2026-10-26 — تعدد العملاء، التحقق بخطوتين، تحضير ZATCA 2، الترخيص والوثائق القانونية

معالجة العيوب 1–8 من «العيوب والمخاطر — الإصدار 1.4.9». **لم تُشغَّل اختبارات PostgreSQL/Docker على جهاز البناء** (انظر `reports/test-report.md`).

- **(4) تعدد العملاء (Multi-tenant)** — مخطط PostgreSQL لكل عميل `t_<رمز>`؛ سجل `platform.tenants`؛ `tenant-cli` (create/list/verify/suspend/resume/archive/set-domain)؛ سياق طلب + مجمّع اتصالات لكل عميل بفشل مغلق؛ هوية العميل من JWT؛ ترحيل لكل المخططات؛ عزل الملفات المرفوعة؛ المتجر العام عبر نطاق فرعي/نطاق مخصص/`/t/<عميل>/`؛ حقل «رمز الشركة» في الدخول. مغلق افتراضياً (`MULTI_TENANT=0`) والتركيب القائم يصبح «الشركة الافتراضية» دون نقل بيانات. `docs/MULTITENANT.md`.
- **(6) التحقق بخطوتين TOTP** (RFC 6238، يعمل مع Google/Microsoft Authenticator): تفعيل بـ QR، 10 رموز استرداد، منع إعادة استخدام الرمز، أسرار مشفّرة AES-256-GCM لا يقرؤها دور التطبيق مباشرة، سياسة «أدوار ملزمة»، إعادة تعيين من المدير، سياسة كلمات مرور (12+ في الإنتاج)، تحديد معدل لخطوة الرمز في nginx. المخطط 0.16.0 (`290_totp.sql`).
- **(1،2) ZATCA المرحلة 2 — تحضير**: C14N، تجزئة صحيحة للفاتورة، توقيع XAdES-BES ECDSA، QR بالوسوم 1–9، CSR، عميل منصة فاتورة معطّل افتراضياً، جداول الاعتماديات والإرسال (المخطط 0.17.0). **غير معتمد ولا موصول بمسار الإصدار** حتى اجتياز `docs/ZATCA_PHASE2.md`.
- **(3) الترخيص**: توحيد على ترخيص تجاري مغلق (`LICENSE`، `package.json: UNLICENSED`، README) مع حفظ نص MIT القديم للمرجع؛ يلزم تأكيد الاسم القانوني (`docs/LICENSING.md`).
- **(5) القانوني**: صفحات `/legal/privacy.html` و`/legal/terms.html` وروابطها في شاشة الدخول، ومسودات DPA وSLA (`docs/legal/`) — **مسودات تحتاج مراجعة محامٍ**.
- **(7،8) الجودة**: `test:all` يشمل الاختبارات الجديدة ويشغّل بناء Docker فعلياً إن وُجد Docker ويعدّ القائمة اليدوية (`docs/QA_MANUAL.md`) شرطاً؛ تقرير الاختبار أُعيد كتابته بصدق كـ INCOMPLETE.
- Dockerfile: نسخ `db/platform` و`schema-expected.json` (كان غائباً عن الصورة فيتخطى فحص المخطط) وتثبيت openssl. إصدار الواجهة والواجهة البرمجية 1.5.0.

## 1.4.9 — 2026-10-24 (إعدادات الموظفين والهيكل التنظيمي)

- إعادة تسمية مجموعة شؤون الموظفين إلى إعدادات الموظفين وإضافة شاشة لإدارة أنواع العقود وهياكل الرواتب وساعات العمل المعتمدة.
- إضافة مخطط تنظيمي بالتبعية الإدارية مع ربط كل موظف بالعقد وهيكل الراتب وساعات الدوام.
- إضافة ترحيل آمن يحفظ السجلات الحالية ويضيف إعدادات الموارد البشرية وعلاقات المدير المباشر.

## 1.4.6 — 2026-10-24 (تقييم الأصناف غير المسعّرة)

- اعتماد تكلفة افتتاحية تقديرية تلقائياً للأصناف ذات الرصيد الموجب ومتوسط التكلفة الصفري: 60% من سعر البيع قبل الضريبة.
- تسجيل كل تقييم تقديري في سجل خاص يوضح الكمية والتكلفة المرجعية وسبب التقييم.
- الإبقاء على الحركات والقيود التاريخية دون إعادة ترحيلها.

## 1.4.5 — 2026-10-24 (إظهار حالة تقييم المخزون)

- توضيح صفحة المنتجات أن السعر الظاهر هو سعر البيع ولا يُستخدم لتقييم الكمية.
- إضافة تنبيه بعدّ الأصناف ذات الرصيد غير المسعّر ورابط مباشر إلى شاشة استكمال التكلفة الموثقة.

## 1.4.4 — 2026-10-24 (إصلاح تقييم المخزون بمتوسط التكلفة)

- إضافة شاشة لاستكمال متوسط التكلفة للأرصدة الموجودة غير المسعّرة، مع تسجيل مرجع المستند والمستخدم والكمية والتكلفة في سجل تدقيق.
- منع البيع أو تسوية الجرد على أصناف متوسط تكلفتها صفر؛ كما يُرفض الاستلام بلا تكلفة عندما يكون للصنف رصيد غير مسعّر.
- احتساب المشتريات التالية بمتوسط التكلفة المتحرك المعتاد. لا تُعدّل المعالجة الجديدة الحركات أو القيود التاريخية.
- ترقية قاعدة البيانات تلقائياً إلى المخطط 0.14.0 مع الحفاظ على البيانات.

## 1.4.3 — 2026-10-24 (إزالة حد الاستخدام المحلي للمساعد)

- إزالة الحدود اليومية والشهرية التي كانت ترفض الاستعلامات المحلية رغم عدم وجود مزود خارجي أو تكلفة.
- الإبقاء على حد الحماية من التكرار: 5 طلبات في الدقيقة لكل مستخدم/ميزة، مع مواصلة تسجيل سجل التدقيق.
- تحديث حالة المساعد لعرض الحد الفعلي بالدقيقة بدلاً من حدود يومية وشهرية مضللة.

## 1.4.2 — 2026-10-23 (توحيد تنسيق الأرقام)

- توحيد الأرقام في إجابات المساعد ومؤشرات الرسوم وتسمياتها على الأرقام الغربية المستخدمة في بقية التطبيق، دون فواصل تجميع.
- الحفاظ على الكسور العشرية للمبالغ، وإظهار قيم المحاور من دون كسور.

## 1.4.1 — 2026-10-23 (إصلاح بدء الواجهة والعمل دون اتصال خارجي)

- إصلاح خطأ JavaScript في جدول بيانات الرسوم المرئية الذي كان يمنع تشغيل الواجهة بالكامل.
- جعل عامل الخدمة يتجاهل المصادر الخارجية ويتعامل بأمان مع تعذر الشبكة والملفات غير المخزنة.
- إزالة اعتماد الخطوط الخارجية واستعمال خطوط النظام، لتحميل الواجهة دون إنترنت أو استثناءات CSP.

# Changelog

## 1.4.0 — 2026-10-23 (التحليلات المرئية للمساعد المحلي)
- إضافة رسوم SVG محلية وبطاقات مؤشرات إلى إجابات ملخصات قاعدة البيانات، مع جدول بديل قابل للفتح ووسوم قراءة الشاشة دون تحميل مكتبات رسم خارجية.
- توسيع الملخصات لتشمل المركز المالي، الإقرار الضريبي، وأعمار الذمم المدينة، إلى جانب المخزون والفواتير والأسطول وبقية التقارير السابقة.
- اعتماد مخطط استعلامات موثوق ومحدد مسبقاً؛ السؤال يوجّه سياق الإجابة ولا يُحوّل إلى SQL أو إلى أوامر تنفيذ.


## 1.3.9 — 2026-10-23 (المساعد المحلي للبيانات)
- تفعيل مساعد محلي افتراضياً دون مزود خارجي أو مفاتيح أو اتصالات API؛ ربطه باستعلامات ثابتة للقراءة فقط مع الصلاحيات وحدود الاستخدام والتدقيق المنقح.
- إضافة ملخصات قاعدة البيانات للفواتير والتحصيل والمخزون والأسطول، إلى جانب تقارير الإيرادات والمصروفات وميزان المراجعة وقائمة الدخل.
- تحديث شاشة المساعد وتوثيق أن الإجابات تحليلية محددة مسبقاً وليست نموذجاً لغوياً عاماً، ومنع تمرير أي استعلامات SQL يكتبها المستخدم.


## 1.3.8 — 2026-10-23 (توضيح نقص المخزون عند فوترة طلبات المتجر)
- تحويل خطأ عدم كفاية المخزون عند فوترة طلب إلكتروني إلى رسالة عربية توضح الصنف والكمية الفعلية والمحجوزة والمطلوبة والكمية اللازمة لتغطية الطلبات القائمة.
- إرشاد المستخدم إلى تسجيل استلام مخزون فعلي أو معالجة الحجوزات المعلقة ثم إعادة المحاولة؛ تبقى حماية المخزون فعالة ولا تُصدر فاتورة أو تتغير الكميات عند الرفض.

## 1.3.7 — 2026-10-23 (إصلاح صفحات الفواتير والطباعة)
- إصلاح تعارض معرّف صفحة الجدول مع معرّف زر طباعة الفاتورة؛ كان النقر على سهم التصفح يرسل طلب طباعة للفاتورة ذات المعرّف 0 ثم يفتح صفحة `not found`.
- إضافة فحص لرد الطباعة قبل فتح نافذة جديدة، وإظهار خطأ مفهوم بدلاً من صفحة فارغة عند تعذر الطباعة.
- إزالة سطر الإجمالي التقديري وملاحظة الإيجار/المخزون من نموذج إصدار الفاتورة بناءً على الطلب.
- إضافة فحص انحدار لتصفح صفحات الفواتير والتأكد من عدم إرسال طلب طباعة عند النقر على السهم.

## 1.3.6 — 2026-10-23 (ملف المؤسسة وإعدادات الحساب)
- إعادة تصميم شاشة «الإدارة وحسابي» لتجمع بيانات المؤسسة ومستخدمي النظام وإعدادات الحساب في واجهة واحدة.
- إضافة اسم المؤسسة بالعربية والإنجليزية، رمز الدولة، العنوان، السجل التجاري والرقم الضريبي، الشعار، العملة الأساسية، وبداية السنة المالية.
- حفظ إعدادات المؤسسة في قاعدة البيانات واستخدام شعارها في شريط التطبيق والفواتير.
- تطبيق شهر بداية السنة المالية على الفترات الافتراضية للتقارير. تغيير الإعداد لا يعيد كتابة الفترات السابقة.
- منع تغيير العملة الأساسية بعد تسجيل قيود أو فواتير، والتحقق من بيانات المؤسسة والشعار قبل الحفظ.
- ترقية آمنة إلى المخطط 0.13.0 بإضافة إعدادات المؤسسة الافتراضية.

## 1.3.5 — 2026-10-23 (إدارة الأسطول ومساعد الذكاء الاصطناعي الاختياري)
- إضافة قائمة الأسطول ضمن الموارد البشرية، تشمل سجل المركبات والملكية والفرع والمسؤول ومواعيد الاستمارة والتأمين والفحص.
- تسجيل الرحلات المخططة والمكتملة، وتعبئات الوقود، وأعمال الصيانة والإصلاحات مع التكاليف والمواعيد القادمة. إكمال الرحلة يحدّث عداد المركبة تلقائياً.
- إضافة تقارير الرحلات والمسافات والوقود والصيانة مع تحديد الفترة والمركبة والفرع، والطباعة وCSV.
- ترقية قاعدة البيانات تلقائياً إلى المخطط 0.11.0. الإضافة تحفظ السجلات الجديدة في PostgreSQL وتمنح القراءة للمستخدمين والتسجيل للمحاسب والمدير.
- تحديث بطاقات إعدادات القوائم إلى أسطح بيضاء ومحايدة، وإزالة اسم المستخدم والدور من أسفل تسجيل الخروج.
- إضافة مساعداً عربياً للوثائق والقواعد وشرح الفواتير وتلخيص التقارير المجمّعة، بمصادر ظاهرة وموصل خادمي قابل للإعداد.
- المساعد متوقف افتراضياً؛ لا SQL حر ولا إجراءات مالية ولا بيانات هوية/IBAN أو أسماء عملاء في سياق المساعد. يسجل التدقيق بيانات الاستخدام المنقحة فقط، مع حدود الطلبات والوقت والتكلفة.
- أضف إعدادات المساعد إلى `.env` بعد مراجعة سياسة مزود الخدمة والحقول المرسلة، ثم أعد تشغيل الخدمات. لا يوضع مفتاح المزود في الواجهة أو المستودع.

## 1.3.4 — 2026-10-22
- **قيود اليومية — فتح تفاصيل القيد:** كان رابط رقم القيد يملأ لوحة التفاصيل أسفل جدول طويل خارج الشاشة فيبدو أنه لا يعمل. صارت التفاصيل تُفتح في نافذة منبثقة (Modal) فوق الصفحة: بنود القيد، إجمالي المدين والدائن، طباعة سند القيد، عكس القيد (للمحاسب/المدير)، والانتقال بين القيد الأصلي وعكسه. كما صار `hash` آمناً عند غياب القيمة.
- **ربط القيود من كل الشاشات:** عمود «القيد المحاسبي» / «قيد الصرف» في المسيرات والعهد والمطالبات صار رابطاً يفتح نفس النافذة (كان نصاً ثابتاً `#123`).
- **ترقيم الصفحات على نمط Odoo في كل القوائم:** 30 مستنداً في الصفحة، وعدّاد `1-30 / 852` وسهمان (السابق/التالي). قائمة القيود تجلب كل صفحة من الخادم (`limit/offset`)، وبقية القوائم تقسّم الصفوف المحمّلة في المتصفح. الطباعة تشمل دائماً كل الصفوف (طباعة سجل القيود تجلب حتى 500 قيد).
- أُلغيت صيغة «المعروض-الإجمالي» (100-852) من 1.3.3 لصالح الصيغة الجديدة؛ وحين يكون المحمَّل أقل من إجمالي قاعدة البيانات (الفواتير: حتى 500) تظهر شارة «من أصل N في قاعدة البيانات».
- `UPDATE-FROM-ZIP.cmd` يتوقع الإصدار 1.3.5 واسم الملف `oklent-business-v1_3_5.zip`.

## 1.3.3 — 2026-10-22
- **بطاقات المؤشرات (KPI) في التطبيق كله:** أُلغيت المستطيلات الملونة الكبيرة (`.kpi` و`.stat`) واستُبدلت بنمط بطاقة لوحة التحكم: بطاقة بيضاء مدمجة بشريط لوني جانبي، العنوان صغير ثم القيمة ثم الوصف. قاعدة CSS واحدة تشمل كل الشاشات.
- **عدّاد المستندات بصيغة موحدة «المعروض-الإجمالي» (مثل 100-852) في كل القوائم:** القوائم المحدودة من الخادم (القيود والفواتير) ترسل `X-Total-Count`؛ والقوائم الكاملة تعرض n-n؛ ومع الفلاتر يظهر المعروض بعد الفلترة مقابل الإجمالي (مثل 0-205).
## 1.3.2 — 2026-10-22
- **إعدادات القوائم:** تصميم بنمط لوحة التحكم: شرائح رئيسية متدرجة الألوان (نفس ألوان بطاقات اللوحة) مع عدّاد الشاشات المفعّلة، وبطاقات الأقسام في تدفق واحد بثلاثة أعمدة (masonry) بلا فراغات، ومربع اختيار لكل قائمة وقسم وشاشة (حالة «جزئي» عند إخفاء بعضها). النموذج البياني والحفظ كما هما.

## 1.3.1 — 2026-10-22 (تقوية أمنية وتشغيلية — Hardening release، لا ميزات جديدة)
- **SEC-01 خصوصية الموارد البشرية:** `GET /api/employees` و`/api/employees/:id` تُرجعان الحقول التشغيلية الدنيا فقط لأي دور غير `accountant`/`admin` (قائمة سماح؛ الحقول الحساسة غير موجودة أصلاً وليست `null`). كان `cashier` يرى الرواتب وIBAN والهوية. مسارات الرواتب والعهد والمصروفات وتقاريرها صارت `accountant` فأعلى.
- **DB-01 / DB-02 الترحيلات:** `tests/migrate-test.sh` أُعيدت كتابته بالكامل (صارم: أي خطأ SQL يوقف الاختبار؛ قاعدة فارغة، ترقية من 3 إصدارات، تكرار التشغيل، التطابق مع تثبيت جديد، حفظ البيانات، ذرّية الفشل). `migrate-cli` يُنهي بكود ≠ 0 عند فشل الترقية فلا تبدأ خدمة api (`MIGRATE_ALLOW_FAILURE=1` للاستثناء الواعي). نُقل الملف الزائد `120_bookings_property_management.sql` إلى `db/legacy/` لأنه كان يكسر التثبيت النظيف.
- **ACC-01 سلامة المحاسبة:** `db_rules_test.sql` لم تعد فحوصه فارغة المعنى؛ و`db_rules_extra.sql` (44 فحصاً): مصفوفة صلاحيات `erpx_app`، حساب غير نشط، تقريب الفلس وضريبة كل بند، الإشعارات الدائنة، الفترة المقفلة، تكرار الرقم، سلسلة ICV/PIH، توازن ميزان المراجعة والميزانية.
- **ACC-02 / T-07 التزامن والتكرار:** اختبار 100 طلب متوازٍ (فواتير، مخزون محدود، حجز واحد يُفوتَر مرة واحدة، موظفون). ترويسة `Idempotency-Key` على `POST /api/invoices` و`/api/public/bookings` و`/api/public/orders` (ترحيل `210_idempotency.sql`، المخطط 0.10.0).
- **DATA-01 / API-01:** رقم الموظف التلقائي = أعلى رقم + 1 تحت قفل استشاري (لا `count(*)`)؛ تحقق صارم من مدخلات الموظفين (400)؛ رسائل أخطاء قاعدة البيانات لا تكشف أسماء الجداول/القيود. أُصلح أيضاً فشل إنشاء موظف براتب كسري.
- **SEC-02/03/05:** Nginx: حدود مشتركة للدخول وللحجز/الطلب العام (`erpx-common.conf`)، حجم جسم 64k للكتابات العامة، موقع HTTPS للإنتاج (`tls.conf` + `docker-compose.prod.yml`)، HSTS. `PUBLIC_RATE_LIMIT_MAX` يُتجاهل فعلاً في الإنتاج.
- **SEC-04 الأسرار:** رفض بدء الإنتاج مع أسرار ضعيفة/افتراضية/مكررة أو مستخدم قاعدة بيانات owner/postgres أو `OWNER_DATABASE_URL` داخل api؛ أداة `config-check-cli.js` قبل النشر؛ `seed-demo` يرفض العمل في الإنتاج.
- **REL-01:** `npm ci` وصور مثبّتة؛ ترقية `@fastify/jwt` 10 و`@fastify/static` 10 (كانت 3 ثغرات حرجة/عالية في `npm audit`)؛ SBOM في CI.
- **OPS-01/02:** `scripts/backup.sh` و`restore.sh` (فحص checksum، تشفير اختياري، رفض الكتابة فوق قاعدة موجودة) مع اختبار استعادة فعلي؛ `/api/livez` و`/api/readyz` (503 عند مخطط قديم) تستخدمهما فحوص الصحة.
- **QA-01:** أمر واحد `cd api && npm run test:all` + تقرير `reports/test-report.md` + `.github/workflows/ci.yml`. أصلحنا `jsdom` (devDependency) وهشاشة اختبار سعر الحجز.

## 1.3.0 — 2026-10-20
- **تاريخ الفاتورة:** حقل «تاريخ الفاتورة» (الافتراضي اليوم، لا يُقبل تاريخ مستقبلي) وحقل «تاريخ الاستحقاق». يُرحَّل قيد الفاتورة بتاريخها، وتُرفض الفترات المقفلة من قاعدة البيانات. عمود التاريخ في القائمة صار بتوقيت الرياض.
- **فترة الإيجار:** عند اختيار منتج تأجير أو حساب 4100 تظهر تلقائياً خانتا «من تاريخ / إلى تاريخ» (إلزاميتان)، وتُحفظ على البند (`invoice_lines.period_from/period_to`) وتظهر في الطباعة وفي XML (`cac:InvoicePeriod`).
- **بنود متعددة ومنتجات في الفاتورة:** اختيار منتج يملأ الوصف والسعر والضريبة وحساب الإيراد، ويمكن تعديل السعر. أصناف المخزون تُخصم من «المخزن» المختار.
- **دورة المخزون بمتوسط التكلفة المتحرك** (`200_inventory_costing_invoice_lines.sql`، المخطط 0.9.0، تُطبَّق تلقائياً بخدمة `migrate`):
  - شراء/استلام: مدين 1140 (+ ضريبة مدخلات 1150) / دائن مورد 2120 (فاتورة مورد) أو صندوق 1110 أو بنك 1121؛ المتوسط الجديد = (الكمية×المتوسط + الداخل×تكلفته) ÷ الإجمالي.
  - بيع (اعتماد الفاتورة): مدين 5100 / دائن 1140 بمتوسط التكلفة وقت الإصدار، قيد واحد للفاتورة؛ البيع بالسالب مرفوض ويُلغى الإصدار كاملاً.
  - الجرد: عجز مدين 5100 / دائن 1140، وزيادة العكس.
  - POS وطلبات المتجر والحجوزات تستفيد تلقائياً (`stock_move` صار مُقيَّماً).
  - أرصدة سابقة بلا قيد: زر «ترحيل قيد الرصيد الافتتاحي» (مدين 1140 / دائن حقوق الملكية) يظهر مع مقارنة قيمة المخزون برصيد 1140.
- **المخزون:** بطاقات ملوّنة مصغّرة وحديثة: أصناف متتبَّعة، إجمالي الكميات، إجمالي قيمة المخزون، منخفض، نفد. الاستلام: تاريخ، تكلفة الوحدة، ضريبة، طريقة الشراء (آجل/نقد/بنك)، المورد. أعمدة متوسط التكلفة والقيمة والقيد في الجداول.
- **المنتجات:** «منتج / خدمة جديدة» في أعلى الصفحة مع شريط الإحصاءات، وحقل تكلفة الوحدة للكمية الافتتاحية.
- حدّ معروف: إشعار الدائن لا يعيد الكمية للمخزون بعد. اختبارات: `tests/inventory-invoice-smoke.mjs` (+ فحوص جديدة في `tests/ui-smoke.mjs`).

## 1.2.1 — 2026-10-20
- **فلتر التاريخ في الفواتير:** حقلا «من تاريخ / إلى تاريخ» وزر «مسح التاريخ» ضمن شريط البحث، ويعملان مع بقية الفلاتر والعدّاد («N من أصل M»). الشاشة تجلب الآن حتى 500 فاتورة بدل 200.

## 1.2.0 — 2026-10-20
- **لوحة تحكم تنفيذية ديناميكية جديدة** (`web/dashboard.js`) بدل لوحة الأعمدة القديمة: وضع داكن افتراضي مع وضع فاتح وطباعة؛ فلاتر (slicers) للفترة (الشهر/الربع/السنة/30 يوماً/الكل) ونوع الفاتورة؛ تحديث يدوي وتلقائي كل دقيقتين.
  - مؤشرات: الإيرادات، المصروفات، صافي الربح وهامشه، النقد والبنوك، ذمم العملاء والموردين، ضريبة المخرجات، عدد الفواتير وقيمتها.
  - رسوم: نسبة التحصيل، الفواتير حسب النوع، حالات الحجوزات وطلبات المتجر، الإيراد مقابل المصروف 12 شهراً، اتجاه المبيعات، أعلى العملاء، أعمار الذمم (مدينة/دائنة)، المصروفات حسب البند، صحة المخزون، الموارد البشرية (حالة/أقسام)، الرواتب والعهد، عقود الإيجار.
  - «تنبيهات تحتاج إجراءً» بروابط مباشرة للشاشات (متأخرات، حوالات معلّقة، حجوزات/طلبات جديدة، اعتمادات، رواتب، مخزون، عقود تنتهي، فواتير موردين، كسر سلسلة الدفتر)، و«مركز العدّادات» وسلامة الدفتر والفترات.
  - قراءة فقط من واجهات API الحالية؛ أي مصدر يتعذّر (صلاحية/شبكة) يُخفي لوحته فقط. رسوم SVG بلا مكتبات خارجية.

## 1.1.2 — 2026-10-20
- **عدّاد السجلات في كل التطبيق:** فوق كل جدول قوائم شارة «عدد الفواتير: N» (الاسم حسب الشاشة: العملاء، الموردين، المسيرات، القيود…). مع الفلترة يظهر «N من أصل M». في الفواتير يُضاف تفصيل حسب النوع (ضريبية / مبسطة / إشعار دائن / مدين). الشارة تُطبع مع الجدول، ولا تظهر في لوحة التحكم والتقارير والمستندات.

## 1.1.1 — 2026-10-20
- **شريط المؤشرات مدمج:** كان الوسم `kpi-grid` بلا أي قاعدة CSS فتظهر بطاقات المؤشرات متراصّة بعرض الصفحة كاملاً (فواتير، موظفون، رواتب، عهد، مصروفات). صار شريطاً مدمجاً من أعمدة متجاوبة، وجدول البيانات داخل منطقة تمرير خاصة به.
- **نموذج الإضافة/الإصدار في أعلى الشاشة:** كل شاشة فيها نموذج «إصدار/إضافة/تسجيل/إنشاء/طلب …» أسفل الجدول يُرفع تلقائياً إلى أعلى (بعد العنوان والتبويبات) كقسم قابل للطي. نماذج «تعديل …» و«تسوية …» لا تُمسّ. المعرّفات والمعالجات كما هي.

## 1.1.0 — 2026-10-19
- **المنتجات في طلب الخدمة (المتجر العام):** نافذة «طلب خدمة / حجز» تتيح إضافة منتجات متوفرة بكميات اختيارية (حتى 9 أصناف) مع ملخص حي. `place_booking` يقبل بنود البضاعة ويتحقق: خدمة أو تأجير واحد على الأقل (ERPX-K029)، المنتج منشور ونشط والكمية متاحة (ERPX-K028)، والأسعار من قاعدة البيانات. فوترة الطلب المكتمل تُنزل رصيد المنتجات المتتبَّعة في معاملة الفاتورة نفسها. ملف ترحيل جديد `190_booking_products.sql` (CREATE OR REPLACE فقط، بلا مساس بالبيانات) وإصدار المخطط 0.8.0 — يُطبَّق تلقائياً بخدمة `migrate`.
- **إعادة تصميم إعدادات المتجر:** ترويسة ملخص (الحالة، النشر، شريط الجاهزية)، أقسام مبوبة (النشاط والميزات، هوية الموقع والتواصل، الدفع والتوصيل والنشر، الجاهزية، متجر جديد)، بطاقات تبديل للميزات ووسائل الدفع، وشريط حفظ ثابت. جميع معرّفات DOM السابقة محفوظة.
- **القوائم:** «المنتجات» انتقلت إلى **المخزون ← المنتجات والأصناف**، و«العروض والخصومات» شاشة مستقلة تبقى في **المبيعات**. (إعدادات إخفاء القوائم المحفوظة لا تتأثر؛ العنصر الجديد `offers` ظاهر افتراضياً.)
- اختبارات جديدة: `api/src/smoke-test.js` (إضافات المنتجات والفوترة وخصم المخزون)، `tests/ui-smoke.mjs`، `tests/shop-smoke.mjs`.

## 1.0.0 — 2026-10-19 (OKLENT BUSINESS)
- **توحيد الهوية التجارية:** اعتماد اسم العرض التجاري الموحد **OKLENT BUSINESS** في كل الواجهات، الترويسات، التذييلات، التوثيق، PWA، وCLI، مع الحفاظ على التوافق التقني المحلي الداخلي.
- **إعادة تصميم واجهة الفواتير والتحصيل:**
  - إصلاح خلل عناوين الأعمدة `undefined` عبر توحيد القاموس وعنونة أعمدة المبالغ والضرائب والإجماليات والمتبقي.
  - إضافة شريط فلاتر وبحث مباشر (برقم الفاتورة أو اسم العميل، نوع الفاتورة، وحالة السداد).
  - بطاقات مؤشرات أداء KPI حية لإجمالي الفواتير وصافي المبيعات والضريبة والمتبقي للتحصيل.
  - تحسين مظهر وإمكانية الوصول لأزرار الإجراءات (طباعة A4، تنزيل XML، تسجيل القبض، وإصدار إشعار دائن).
- **إعادة تنظيم شاشة إعدادات المتجر والموقع:**
  - تنظيم الإعدادات في أقسام وتبويبات واضحة (نوع النشاط والميزات، إعدادات الموقع والتوصيل والدفع، جاهزية التشغيل، وإضافة متجر جديد).
  - الحفاظ التام على جميع معرّفات DOM لضمان استقرار الاختبارات والتكامل.
- **وحدة الموارد البشرية والرواتب (HR & Payroll):**
  - جدول وسجل الموظفين، عقود العمل، الرواتب والبدلات، الاستقطاعات والتأمينات GOSI، والحسابات البنكية.
  - حجب بيانات الرواتب الحساسة عن دور المشاهد (`viewer`).
  - مسيرات الرواتب الشهرية والاحتساب الآلي والاعتماد والترحيل المحاسبي المتوازن لدفتر الأستاذ العام (`fn_post_payroll` و `fn_pay_payroll`).
  - منع حذف الموظفين المرتبطين بمسيرات أو عهد مالية (`trg_prevent_employee_delete`).
- **وحدة العهد النقدية ومطالبات المصروفات (Custody & Expense Claims):**
  - صرف العهد التشغيلية للموظفين (حساب 1170) عبر قيد محاسبي معتمد (`fn_post_custody`).
  - تسوية العهد بالمستندات المؤيدة واحتساب ضريبة المدخلات (1150) وتوريد الفائض النقدي (`fn_settle_custody`).
  - تقديم مطالبات المصروفات واعتمادها الإداري وترحيلها محاسبياً (`fn_post_expense_claim`).
- **تقارير الموارد البشرية والمالية:**
  - تقرير ملخص مسيرات الرواتب الشهرية حسب الفترة والفرع.
  - تقرير أرصدة العهد النقدية القائمة للموظفين ومطابقتها مع حساب 1170.
  - تقرير كشف المصروفات والمطالبات حسب التصنيف والفرع مع إمكانية التصدير إلى CSV.
- **ترقية قاعدة البيانات والترحيل التلقائي:**
  - ملفا الترحيل `180_hr_payroll_custody_expenses.sql` و `185_hr_grants.sql`.
  - تحديث إصدار المخطط المتوقع إلى `0.7.0` في `api/src/migrate.js` و `db/schema-expected.json`.
- **توثيق نطاق ZATCA:** توضيح دقيق لاكتمال دعم المرحلة الأولى (Phase 1) وعدم تنفيذ متطلبات المرحلة الثانية (Phase 2 - CSID والتوقيع الرقمي والربط المباشر مع منصة فاتورة).

## 0.9.2 — 2026-10-18
- **كشف الواجهة القديمة:** `/api/health` يعرض `version`، والواجهة تعرض `v0.9.2` في التذييل وتنبّه عند اختلافها عن الخادم («استبدل مجلد web ثم Ctrl+F5»). سببها: لقطة نقاط البيع الأخيرة ما زالت تُظهر تذييل الإصدار القديم، أي أن الملفات القديمة هي التي تعمل. اختبار وحدة يمنع اختلاف أرقام الإصدار الثلاثة.
- **نقاط البيع:** اسم المستخدم (الكاشير) يظهر في ترويسة الشاشة وفي بطاقة السلة؛ وفي الفاتورة المطبوعة حقل «أصدرها (المستخدم)». (الصور في بطاقات نقاط البيع أُضيفت في 0.9.1.)

## 0.9.1 — 2026-10-17
- **نقاط البيع:** بطاقات المنتجات تعرض الآن صورة المنتج (أو علامة بديلة) وسطر السلة يعرض صورة مصغّرة؛ الصورة المكسورة تُستبدل بعلامة دون كسر التخطيط. (كانت بطاقات نقاط البيع بلا صور في الإصدارات السابقة.) اختبار: `npm run test:images` (+3).

## 0.9.0 — 2026-10-17
**الفواتير: تصميم الطباعة وفق نموذج هيئة الزكاة والضريبة والجمارك (المرحلة الأولى — الإصدار)** (`api/src/invoice-print.js`، تغيير في الطباعة فقط بلا مساس بقاعدة البيانات أو الـ XML أو الـ QR أو التسلسل):
- **الفاتورة الضريبية (B2B):** عنوان ثنائي اللغة، رقم الفاتورة، تاريخ ووقت الإصدار (بتوقيت الرياض)، تاريخ التوريد والاستحقاق، البائع (الاسم والعنوان الوطني والرقم الضريبي والسجل التجاري)، **المشتري (الاسم والعنوان والرقم الضريبي إن كان مسجلاً)**، وQR.
- **الفاتورة المبسطة (B2C):** نفس العناصر مع **QR إلزامي وأكبر**، والمشتري اختياري («عميل نقدي»).
- **البنود:** الوصف، الكمية، سعر الوحدة، **الخصم**، الصافي، نسبة الضريبة، **مبلغ الضريبة**، **إجمالي البند شاملاً الضريبة**.
- **الإجماليات:** قبل الخصم، إجمالي الخصم، بدون ضريبة، تفصيل الضريبة بحسب النسبة (عند تعدّد النسب)، إجمالي الضريبة، **الإجمالي شامل الضريبة**.
- **الإشعارات الدائنة/المدينة:** رقم الفاتورة الأصلية وسبب الإصدار.
- A4، هوامش 15/12 مم، ترويسة الجدول تتكرر في كل صفحة، منع كسر الصف بين الصفحات، ألوان الطباعة محفوظة، بلا سكربتات (متوافقة مع CSP).
- اختبار: `npm run test:unit` (+10 فحوص للطباعة). عاينت التصميم كملف PDF للأنواع الثلاثة.
**ملاحظة:** ملف المصدر المرفق لم تصل صوره (image-1..3 غير مضمّنة)، فاعتمدت على نصه وعلى عناصر المرحلة الأولى المعروفة؛ إن أردت مطابقة شكل بصري محدد أرسل الصور. **غير مضمَّن:** تفقيط المبلغ بالحروف (ليس شرطاً من الهيئة)، والتوقيع الرقمي ووسوم QR 6–9 (المرحلة الثانية).

## 0.8.1 — 2026-10-17
- **صور مكسورة في المتجر/الجدول:** السبب الأرجح أن حاوية nginx القديمة بقيت تعمل بإعدادها السابق فلا تعرف مسار `/uploads/` (docker لا يُعيد إنشاءها عند تغيّر ملف إعداد مثبّت فقط). أُضيف متغير `ERPX_WEB_CONF` في `docker-compose.yml` حتى يُعيد `up -d` إنشاء الحاوية تلقائياً. الحل الفوري: `docker compose up -d --build --force-recreate web`. وأُضيف بديل: أي صورة لا تُحمَّل تُستبدل بعلامة بدل أيقونة الصورة المكسورة (جدول المنتجات والمتجر).
- **المتجر:** رابط «النظام» في الترويسة و«الدخول إلى النظام (للموظفين)» في التذييل للرجوع إلى النظام (`/`).
- **التذييل في كل الشاشات:** «© 2026 OKLENT BUSINESS. جميع الحقوق محفوظة».
- **إصلاح:** عنوانا عمودي «السعر» و«الخصم» في جدول المنتجات كانا يظهران «undefined».

## 0.8.0 — 2026-10-17
**1) صور المنتجات (رفع من الجهاز + تخزين دائم):**
- شاشة المنتجات: عمود «الصورة» في الجدول، وزر **اختيار صورة من الجهاز** في نموذج الإضافة مع **معاينة قبل الحفظ**، وزر «الصورة» لكل صف (استبدال/حذف) مع معاينة. الرابط الخارجي (https) ما زال متاحاً كخيار.
- التحقق: JPG / PNG / WebP فقط، حتى **2 ميجابايت**. يُتحقق في المتصفح (رسالة فورية) ثم في الخادم من **محتوى الملف نفسه** (signature) لا من اسمه ولا من Content-Type؛ SVG وGIF وHTML مرفوضة (SVG قد يحمل سكربت).
- التخزين: ملف باسم UUID عشوائي في `/app/uploads/products` على **volume دائم `erpx_uploads`**، والمسار `/uploads/products/<uuid>.<ext>` يُحفظ في `products.image_url`. **تبقى الصور بعد `docker compose down` وإعادة البناء** (تُفقد فقط مع `down -v`). عند الاستبدال/الحذف يُحذف الملف القديم؛ إن فشل تحديث السجل يُحذف الملف الجديد (لا ملفات يتيمة ولا مسارات معلّقة).
- الأمان: الرفع للأدوار accountant/admin، والمصادقة تجري قبل قراءة الجسم (onRequest)، ولا يُحذف إلا ملف يطابق نمط UUID الخاص بنا. `/uploads` يُقدَّم بـ `nosniff` و`CSP: default-src 'none'; sandbox` وبلا عرض مجلدات؛ وNginx يسمح بجسم أكبر من 1m على مسار الرفع فقط (3m).
- تظهر الصورة في جدول المنتجات وفي المتجر الإلكتروني (البطاقة ونافذة التفاصيل والسلة).
- API جديد: `POST /api/products/:id/image` (جسم خام image/jpeg|png|webp) و`DELETE /api/products/:id/image`. **لا تغيير في مخطط قاعدة البيانات** (يستخدم `image_url` الموجود).
- **نسخ احتياطي:** احفظ `erpx_uploads` مع `erpx_pgdata`، مثلاً: `docker run --rm -v oklent-erpx_erpx_uploads:/d -v "%cd%":/b alpine tar czf /b/uploads.tgz -C /d .`

**2) المتجر: ترتيب الأقسام** المنتجات ← الخدمات ← **الحجوزات**. زر «احجز موعد فني» انتقل من بطاقة الخدمة إلى قسم الحجوزات (اختيار الخدمة/التأجير ثم الزر)، وبطاقة الخدمة صارت «اطلب الخدمة» التي تنقل العميل إلى الحجوزات مع اختيار الخدمة. التأجير يظهر تحت الحجوزات. شريط تنقل بين الأقسام. **قسم الحجوزات يظهر فقط إذا كانت ميزة «الحجز» مفعّلة للمتجر** (الفروع ← إعدادات المتجر ← الميزات ← الحجز) لأن الخادم يرفض الحجز بدونها.

**3) التذييل:** استُبدل OKLENT.NET بـ **OKLENT BUSINESS © حقوق النشر محفوظة** في كل الشاشات (الواجهة، الدخول، القائمة الجانبية، المتجر العام، طباعة الفاتورة، ذيل CSV، صفحات التوثيق).

**اختبارات:** `npm run test:unit` (+9 فحوص للرفع والنشر) · `npm run test:shop` (56) · `npm run test:images` (15، شاشة المنتجات بلا قاعدة بيانات). تحقّقت يدوياً أن الخادم يقدّم `/uploads` بالترويسات الصحيحة ويرفض اجتياز المسار (403) والرفع بلا تسجيل دخول (401).
**NOT VERIFIED:** لم يتوفر PostgreSQL ولا Docker ولا متصفح عندي: مسار الرفع الكامل (الكتابة في قاعدة البيانات + volume) واختبارا `ui-smoke` و`smoke-test` لم يُشغَّلا، والتصميم لم يُفحص بصرياً.

## 0.7.1 — 2026-10-17
**إصلاح المتجر:** سلة التسوق كانت تظهر فارغة وعالقة وهي «مغلقة» (في RTL كان الإزاحة تُدخل الدرج إلى الشاشة بدل إخراجه). صار الدرج على الجهة اليسرى ويخرج كلياً من الشاشة ويُخفى عن لوحة المفاتيح عند الإغلاق. وإصلاح التباين في الوضع الداكن (البانر والشريط العلوي والتذييل كانت تنقلب إلى ألوان فاتحة بنص أبيض). ملاحظة: اختبار jsdom لا يطبّق CSS، لذلك لم يكشف الخلل؛ التحقق البصري يتم في المتصفح.

## 0.7.0 — 2026-10-17
**1) القوائم:** «الفواتير والمبيعات» أُعيدت تسميتها إلى **«تقارير المبيعات»** ونُقلت من قائمة «المبيعات» إلى قسم **«التقارير»** (التقارير المالية · تقارير المبيعات · تقارير المشتريات). الشاشة نفسها (`salesrep`) والـ API كما هما؛ تغيّر موضعها واسمها فقط. «الفواتير والتحصيل» تبقى في المبيعات لأنها شاشة التشغيل (إصدار/قبض/إشعار دائن). تم تحديث `nav.json` والاختبارات (`ui-smoke`, `smoke-test`) و`FAQ.md`. الأذونات لم تتغير (تُفرض في الخادم).

**2) واجهة المتجر العامة `/shop/<slug>` أُعيد تصميمها بالكامل** على نمط المنصات الكبرى (سلة/زد/شوبيفاي) — واجهة فقط، **بلا تغيير في قاعدة البيانات أو الـ API**:
- شريط إعلان + ترويسة ثابتة مع **بحث فوري** (اقتراحات، تجاهل الهمزات والتشكيل) وسلة ومفضلة.
- بانر رئيسي + شريط مزايا (توصيل/دفع آمن/استرجاع/دعم) + قسم «عروض خاصة» تلقائي من الخصومات السارية.
- تصنيفات (chips بعدد المنتجات) + ترتيب (سعر/خصم/اسم) + تصفية (متوفر فقط/عروض فقط/النوع) + «عرض المزيد».
- بطاقة منتج: شارة نسبة الخصم، السعر القديم، آخر الكميات، نفدت، مفضلة، عدّاد كمية مباشر في البطاقة.
- نافذة تفاصيل المنتج (كمية، منتجات مشابهة، رابط مباشر `#p<id>`، نسخ الرابط).
- **سلة جانبية** مع شريط التقدم نحو التوصيل المجاني، الحد الأدنى للطلب، تفصيل الضريبة والتوصيل؛ تُحفظ في المتصفح.
- **إتمام الطلب**: تحقق فوري، تحويل الأرقام العربية، حفظ بيانات العميل محلياً، بطاقات اختيار الدفع، شاشة نجاح مع زر واتساب.
- زر واتساب عائم، ذيل الصفحة (تواصل/شحن/دفع/استرجاع)، وضع داكن تلقائي، جوال أولاً، هيكل تحميل (skeleton)، وصول (aria/لوحة المفاتيح).
- **تصحيح**: حدّ التوصيل المجاني والحد الأدنى للطلب يقارنان المبلغ **قبل الضريبة** كما تفعل قاعدة البيانات (الواجهة القديمة كانت تعرض مجموعاً شاملاً الضريبة فتضلّل العميل)، ولا يظهر التوصيل إلا إن كانت ميزة «delivery» مفعّلة للمتجر.
- ملفات: `web/shop.html` · `web/shop.css` (جديد) · `web/shop.js`. سياسة CSP كما هي (لا سكربتات مضمّنة).
- اختبار جديد بلا قاعدة بيانات: `cd api && npm i --no-save jsdom && npm run test:shop` (46 فحصاً: العرض، XSS، البحث، حساب السلة مطابقاً لـ `place_online_order`، التحقق، الأخطاء، المفضلة، الرابط المباشر).

**غير منفَّذ بعد (يحتاج جداول/API جديدة — مرحلة لاحقة):** صور متعددة للمنتج، المتغيرات (مقاس/لون)، كوبونات خصم، تقييمات، تتبّع الطلب للعميل، بوابة دفع إلكتروني (مدى/Apple Pay)، بانرات وأقسام قابلة للتحرير من لوحة الإدارة، حسابات العملاء، SEO لكل منتج (يتطلب عرضاً من الخادم).
**NOT VERIFIED:** لم يتوفر PostgreSQL ولا متصفح في بيئتي؛ اختباري `ui-smoke` و`smoke-test` (القوائم) لم أشغّلهما، وتصميم الواجهة لم يُفحص بصرياً. اختبارات الوحدة (`test:unit`) واختبار المتجر (`test:shop`) نجحا.

## 0.6.1 — 2026-10-16
**Why 0.6.0 was not enough:** on your database `docker compose logs migrate` said *half-upgraded platform schema, missing: owners, property_ownership, technicians, bookings, booking_lines, stock_moves* and refused to continue. Your logs showed why: `125`, `130` and `160` had been applied by hand BEFORE `120`, so the geography tables existed (created by hand → **no privileges for the API role → «permission denied for table sa_regions» on /api/geo**) while the booking/technician/owner/stock tables did not, and `products.allow_negative` was missing (**«column allow_negative does not exist» on store readiness**).

**Fixed**
- **The upgrade now repairs a half-upgraded database** instead of refusing: new idempotent `121_platform_repair.sql` (everything `120` creates, written as IF NOT EXISTS / CREATE OR REPLACE / re-created triggers / add-column-if-missing; never deletes business data), `125` tolerates a database without `bookings`/`technicians`, new idempotent `175_grants.sql` restores the API role's privileges.
- **Self-check:** after upgrading, `migrate` compares the database with `db/schema-expected.json` (42 tables, 408 columns generated from a fresh install) and prints every table/column still missing, so no further guessing.
- Verified on a simulation of your exact state (hand-applied 125/130/160, no grants, no `allow_negative`): after `docker compose up -d --build` → 124 API + 70 UI + 28 DB-rule checks pass; a second run changes nothing; a brand-new database (now running 121 on top of 120) passes the same suites.

**Do this:**
```
docker compose up -d --build
docker compose logs migrate
```
Expected: `database upgraded automatically: 121_platform_repair.sql, 125_geo_saudi.sql, …` then `schema check: all expected tables and columns exist`. Then hard-refresh the browser (Ctrl+F5). If the last line instead says `SCHEMA CHECK: still missing -> …`, send me that line.
Note: the Saudi geography is reloaded from the official list in this repair (nothing references it yet in your database); the demo catalogue/technicians are NOT added to upgraded databases.

## 0.6.0 — 2026-10-16
Fix for **«تعذّر تحميل هذه الشاشة — internal error [500 GET /api/owners]»** and the other screens that failed the same way (Bookings, Technicians, Stock, Units, Properties, Regions/Cities). Reproduced on a database built by an older package: PostgreSQL answered `relation "property_ownership" does not exist`. Cause: `db/init/*.sql` run only when a volume is created, and the 0.5.0 upgrade notes covered only 0.4.1 → 0.5.0.

**Fixed**
- **Automatic, safe database upgrade.** New one-shot compose service `migrate` runs before `api`: it recognises the database by the objects that really exist, adds the missing platform schema (`120_platform.sql`, `125_geo_saudi.sql`, menu settings, then the idempotent `150/160/170`) each file in its own transaction, keeps all data, is safe to re-run, and refuses to guess on a half-upgraded database (it reports exactly what is missing). The owner credential lives only in that short-lived container — the `api` container still connects as the least-privilege `erpx_app` role. Demo catalogue (`130`) is not added to upgraded databases.
- **Honest errors:** a missing table/column/function now returns **503 `SCHEMA_OUTDATED`** with an Arabic instruction instead of a bare «internal error»; health reports `schema: outdated`.
- **Storefront (`/shop/<slug>`)**: no more endless «جارٍ التحميل» when the API is unreachable (message + retry); changing a quantity in the checkout dialog no longer closes it; order/booking buttons recover after a network failure; failure to load regions/cities is reported instead of throwing.
- Docker image now contains `db/init` (needed by `migrate`); added `.dockerignore`; `reset-demo.cmd` for rebuilding a DEMO database.

**Tests:** 28 DB rules, 124 API checks, 70 UI checks (all also run on a database upgraded from a pre-0.4 baseline), unit checks incl. the upgrade classifier.

**Upgrade (keeps data, any older volume):**
```
docker compose up -d --build
docker compose logs migrate
```
`docker compose logs migrate` should say `database upgraded automatically: …` once, then `already up to date`.
If it says `DATABASE UPGRADE FAILED … half-upgraded`, the volume is in an unknown partial state: send me that log line, or for DEMO data run `reset-demo.cmd`.
NOT VERIFIED — REQUIRES TESTING on your machine: Docker/nginx were not available in my build environment; the migrator, API, DB rules and UI were tested against PostgreSQL 16 directly. Your volume may differ from the baseline I reproduced.

## 0.5.0 — 2026-10-12
Code review of Bookings, Store, Stock and Regions/Cities/Districts (baseline: v0.4.1 as uploaded, including its nginx web tier).

**Fixed (data integrity)**
- **Stock: a FULFILLED order that was not yet invoiced released its reservation without deducting stock** → the item could be sold twice. Fulfilled-not-invoiced orders now keep holding their stock until invoiced (`fn_reserved`).
- **Stock: POS / invoicing could sell stock reserved by other online orders.** A sale now needs `available = on hand − reserved` (ERPX-K001); manual stock-count corrections still follow the physical balance.
- **Public cart: the same product twice in one cart bypassed the stock check.** Refused (ERPX-O008).
- **Bookings: issuing a B2B invoice overwrote the customer matched by phone** (name + VAT of a person replaced by the company). It now reuses/creates the company partner by VAT number and leaves the customer untouched.
- Stock count: product row locked before reading the balance (no stale differences under concurrency).
- Geography: a city created by import / API did not get the catch-all district «أخرى / غير مدرج».
- Geo import: region names are matched tolerantly («الرياض» = «منطقه الرياض»; ة/ه, ى/ي); an unknown region lists the valid ones.

**Usability**
- Products: **stock tracking + opening quantity** can be set when creating a product and switched on later (before, products created in the UI could never appear in stock). Services/rentals cannot track stock; tracking cannot be switched off while the balance is not zero.
- Stock: store selector, store-scoped balances/movements, KPIs (tracked / out / low), inline receipt form (no more prompt boxes), live difference in the count screen.
- Bookings: status filters with counts + search; **technician list per booking sorted same-city first and busy technicians disabled for the chosen slot** (`GET /api/bookings/:id/technicians`); technicians have region→city and can be edited.
- Store readiness now checks the booking setup (feature enabled + at least one active technician).
- **Icons beside every main menu, section and screen** (inline SVG set `web/icons.js`, mapped in `web/nav.json`; also shown in page titles and in إعدادات القوائم).

**Operations**
- nginx web tier (from v0.4.1) verified end to end: serves `web/`, forwards `/api` and `/shop`, `index.html`/`sw.js` are never cached, public port stays 3100. Added an explicit `application/manifest+json` type for `manifest.webmanifest`.
- New migration `db/init/160_fixes_0_5.sql` (idempotent; marks schema 0.5.0 — the API warns when the database is older than the code).
- Test-only `PUBLIC_RATE_LIMIT_MAX` raises the public order/booking limits (ignored when `NODE_ENV=production`).
- Tests: 28 DB rules, 124 API checks, 70 UI checks (also run through nginx).

**Upgrade from 0.4.1 (keeps data):**
```
docker compose exec -T db psql -U erpx_owner -d erpx -v ON_ERROR_STOP=1 < db\init\160_fixes_0_5.sql
docker compose up -d --build
```

## 0.4.1 — 2026-10-11
- **Old database + new code is now detected.** `db/init/*.sql` run only when a database volume is first created, so a volume built by an older package made screens fail with 500 (Bookings) and the demo seed fail with a foreign-key error (`units_unit_type_fkey`). New `150_schema_version.sql` writes a schema marker; the API logs a clear *DATABASE SCHEMA IS OLDER THAN THIS APP* error on start and `GET /api/health` reports `schema: ok|outdated`. Fix for demo data: `docker compose down -v` then `docker compose up -d --build`.
- Health checks no longer flood `docker compose logs api` (they are logged only on failure).

## 0.4.0 — 2026-10-11
**Menus (final decision from the implementation-report workbook)**
- Main menu **المحاسبة → إدارة الأعمال**. Section **المالية والحسابات العامة → المالية**.
- New section **التقارير** (inside إدارة الأعمال) holding **التقارير المالية** and **تقارير المشتريات** (moved out of المالية and المشتريات). No report was added that does not exist.
- النظام: «الرئيسية» → **«لوحة التحكم»** (same name as the screen title).
- Menu ids are unchanged, so saved *إعدادات القوائم* keep working. Side effect: تقارير المشتريات now follows the التقارير section, not المشتريات.
- Functional difference documented on the screens: **الفواتير والمبيعات** is a read-only sales report; **الفواتير والتحصيل** is the operational screen (issue, print, collect, credit note). **الذمم والمدفوعات** = customer receivables ageing; **الذمم الدائنة والمدفوعات** = vendor payables ageing. Nothing was merged.
- إعدادات القوائم states explicitly that hiding is UI-only and not a substitute for permissions. The tab picks up menu changes made by another admin on focus; a hidden current screen falls back to a visible one.

**Web tier (nginx)**
- New `web` service (nginx:1.27-alpine) serves `web/` and forwards `/api` and `/shop` to `api`. Public port stays **3100**. The `api` service is now internal (healthcheck added). `index.html` and `sw.js` are `no-store`; every other static file is revalidated. Hidden files are refused except `/.well-known`. DB port 5434 is bound to 127.0.0.1.

**Security**
- Production refuses to start with a default/weak `JWT_SECRET` (< 32 chars) or database password (< 12 chars, default or "change-me"). `.env.example` now defaults to `NODE_ENV=development`.
- Sign-in lockout: 8 failures per user+IP (and 10x per IP) in 15 minutes → HTTP 429 + `Retry-After`; nginx adds a per-IP rate limit on `/api/auth/login` and `/api`. Malformed sign-in bodies → 400.
- Content-Security-Policy (no inline script), nosniff, frame deny, referrer policy; API responses are `no-store`. The invoice print page has no inline script — the client calls `print()`. The old duplicate header hook was removed.
- Documentation Markdown: raw HTML is escaped and `javascript:`/`data:` links are neutralised.

**Tests:** 100 API checks, 60 UI checks (run through nginx), 26 unit checks (`npm run test:unit`, no database), 28 DB rule tests. CSP enforcement is not exercised by jsdom — check the browser console after upgrading.

**Upgrade from 0.3.x (no data wipe, no SQL migration):** `docker compose up -d --build` (the whole stack, because `web` is new). If your `.env` has `NODE_ENV=production`, set strong secrets first or the API will refuse to start.

**Still open (not part of this release):** per-company/branch authorisation review (IDOR), ZATCA Phase 2, inventory valuation, booking-conflict engine, payment/shipping integrations, backup/restore drill, load test, Egypt ETA connector.

## 0.3.1 — 2026-10-11
- **Fix: a screen that fails to load stayed on "جارٍ التحميل…" forever** (the view's async errors were never awaited). Now the error and the failing URL are shown inside the screen with a retry button, and unexpected errors raise a toast.
- Store settings screen: a failure in the site-settings or readiness request no longer blanks the whole screen; it renders with a warning.
- Static files are always revalidated (`Cache-Control: no-cache`) and the service-worker cache version was bumped, so an upgrade never leaves stale JavaScript in the browser.
- UI smoke test: 52 checks (adds the error-display check).

## 0.3.0 — 2026-10-11
**Menus (approved structure in اعتماد ترتيب القوائم.html)**
- Main menus in this order: **المحاسبة → المتجر → الإدارة → النظام** (النظام last). Source of truth: `web/nav.json`.
- **المحاسبة** opens to four sections — المبيعات · المشتريات · المخزون · المالية والحسابات العامة — all collapsed; a section's items appear only when it is clicked. Sales order: الفواتير والمبيعات, عقود الإيجار, الفواتير والتحصيل, الحجوزات, العملاء, المنتجات والعروض, الحوالات, البيع الإلكتروني (+ نقاط البيع when enabled).
- **إدارة الأملاك / العقارات removed** from the main menus. عقود الإيجار moved under المبيعات. The properties/units and owners screens still exist but are hidden by default (enable them in إعدادات القوائم).
- **التوثيق moved under الإدارة.**
- Type scale: main menu 16px / 800 → section 14px / 700 → item 13px / 400.
- **New: الإدارة ← إعدادات القوائم** — switches (تم التفعيل / تم التعطيل) for every main menu, section and screen, saved for everyone (`app_settings`, `GET/PUT /api/menu-settings`). Settings screen and Users cannot be hidden (no lock-out). This hides UI only; permissions are unchanged.

**Geography (supplied workbook)**
- 13 regions, 134 cities, 1,329 districts (the workbook has 1,330 rows; one duplicate name inside a city was merged) + one "أخرى / غير مدرج" district per city. Spelling kept exactly as supplied.
- The workbook has **no city → region column** and only 134 cities carry districts (not 251). City→region links were assigned by the project; 12 uncertain cities are flagged *تحتاج مراجعة* — fix them in المتجر ← المناطق والمدن والأحياء (`PUT /api/geo/cities/:id`). Review list: `db/data/saudi-city-regions.csv`.

**Upgrade from 0.2.0 (no data wipe, refuses if bookings exist):**
```
docker compose exec -T db psql -U erpx_owner -d erpx -v ON_ERROR_STOP=1 < db\init\125_geo_saudi.sql
docker compose exec -T db psql -U erpx_owner -d erpx -v ON_ERROR_STOP=1 < db\init\140_menu_settings.sql
docker compose up -d --build api
```
Tests: 88 API checks, 28 DB rule tests, UI smoke with 50 checks (navigation order, accordion, type scale, settings flows).

## 0.2.0 — 2026-10-10
**Fixed**
- Saving *Store settings → Website* failed with `invalid input syntax for type integer: '30.00'`. Cause: PostgreSQL inferred an INTEGER type for `coalesce($12,0)` (delivery fee, minimum order) and for the product `cost_price`. All money parameters are now explicitly `::numeric`, and the API rejects non-numeric money with HTTP 400.
- Colour picker in the website form rendered as a flat line (global `input` padding) — fixed in `style.css`.

**Added**
- Storefront auto-setup (`api/src/site-defaults.js`): defaults by commerce type (title, tagline, about, return policy, payment methods, delivery fee/free-delivery threshold). Applied on store creation (overwrite), on store type/feature change and on API start (fill-blank only — an admin's own text is never overwritten).
- Go-live readiness checklist (`GET /api/stores/:id/readiness`) shown as section ٣ in *Store settings*; auto-publish on start only for sites that pass every check (disable with `AUTO_PUBLISH_READY_SITES=false`).
- `POST /api/stores/:id/site/defaults` (admin) with `{overwrite:true|false}` and two buttons in the UI.
- Tests: 9 new API checks (79 total), `tests/ui-smoke.mjs` opens all 35 sub-menus and runs the write flows in a headless DOM.

**Upgrade** — no database migration and no data wipe: `docker compose up -d --build api`.

# 1.4.7 — 2026-10-24 (إصلاح التقارير المالية والإدارية)
- إصلاح استعلام بداية السنة المالية الذي تسبب برسائل 500 في تقارير اليومية والأسطول والدخل.
- إعادة مواءمة حقول تقارير الرواتب والعهد والمصروفات مع البيانات التي تعرضها الجداول، وتجميع النتائج بالمستوى الظاهر.
- إضافة فلتر القسم لقائمة المركز المالي، وتسميه فلتر اختيار التقرير «النوع».
- ضمان صلاحية تشغيل وظائف التقارير على قواعد البيانات التي جرى تحديثها سابقاً.

## 1.4.8 — 2026-10-24 (تفاصيل التقارير وتصحيح دفتر اليومية)
- إضافة تصفية الحساب في التقارير المالية، وإظهار نوع الحركة والحساب في دفتر اليومية.
- استبدال المذكرات المحفوظة بعلامات استفهام بوصف عربي واضح في تقرير اليومية مع المحافظة على القيود الأصلية.
- إضافة تفاصيل فواتير المبيعات والمشتريات، وإجماليات عدد الفواتير وصافي المبالغ والضريبة والإجمالي والمتبقي في العرض والطباعة.
- فصل تصدير ملخص المبيعات/المشتريات عن تصدير تفاصيل الفواتير.

