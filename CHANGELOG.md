# Changelog

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
