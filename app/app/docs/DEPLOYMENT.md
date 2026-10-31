# دليل النشر الإنتاجي — OKLENT BUSINESS 1.3.1

> الأوامر بالإنجليزية كما هي. ما لم يُختبر فعلياً في بيئة التطوير مذكور صراحة في «ما لم يُتحقق منه».

## 1) الأسرار (SEC-04)
```bash
cp .env.example .env && chmod 600 .env        # ثم عدّل القيم: أربعة أسرار مختلفة وقوية، و NODE_ENV=production
openssl rand -base64 48                        # JWT_SECRET (≥ 32 حرفاً)؛ كلمات مرور قاعدة البيانات/المدير ≥ 12 حرفاً
node api/src/config-check-cli.js .env          # يرفض الافتراضي/الضعيف/المكرر و .env المقروء لغير المالك
```
الـ api نفسه يرفض البدء في الإنتاج عند: سر ضعيف أو افتراضي، مستخدم قاعدة بيانات `erpx_owner`/`postgres`، وجود `OWNER_DATABASE_URL` داخل حاويته، أو `PUBLIC_RATE_LIMIT_MAX`. لا تُسجَّل الأسرار ولا أجسام الطلبات ولا ترويسة Authorization (يتحقق منه `tests/ops-check.mjs`).

## 2) HTTPS (SEC-05)
1. ضع الشهادة في `deploy/certs/fullchain.pem` و`privkey.pem` (Let's Encrypt/certbot أو شهادة جهة معتمدة). المجلد خارج git.
2. شغّل مجموعة الإنتاج (لا تنشر منفذ قاعدة البيانات، ولا يوجد منفذ 3100 عام):
```bash
docker compose -f docker-compose.prod.yml up -d --build
curl -sI http://YOUR_HOST/ | head -3        # 301 -> https
curl -sI https://YOUR_HOST/ | grep -i strict-transport-security
```
HTTP يُحوِّل إلى HTTPS؛ TLS 1.2/1.3 فقط؛ HSTS وCSP وnosniff وX-Frame-Options في كل استجابة. فعّل HSTS preload فقط بعد التأكد من HTTPS على كل النطاقات الفرعية.
`docker-compose.yml` (التطوير) يبقى HTTP على 3100 ولا يصلح للإنتاج.

## 3) حدود المعدل (SEC-02/03) — «حدود موثقة»
| المسار | أين | الحد |
|---|---|---|
| `/api/auth/login` | Nginx (مشترك بين كل نسخ api) | 60 طلب/دقيقة/IP + burst 20 |
| `POST /api/public/bookings` و`/orders` | Nginx | 10 طلب/دقيقة/IP + burst 5، جسم ≤ 64KB |
| `GET /api/public/*` | Nginx | 30 طلب/دقيقة/IP + burst 30 |
| باقي `/api/` | Nginx | 50 طلب/ثانية/IP + burst 100 |
| تسجيل الدخول لكل مستخدم | api (في الذاكرة، لكل نسخة) | `LOGIN_MAX_FAILS` فشل ثم 429 + Retry-After |
| حجوزات/طلبات عامة | api (في الذاكرة، لكل نسخة) | 10 / 10 دقائق / IP |
حدود Nginx هي الطبقة الفعّالة عند تعدد نسخ api لأنها نقطة دخول واحدة؛ حدود api طبقة إضافية لكل نسخة. إن وُضع Cloudflare أو موازن أمامه فاضبط `TRUST_PROXY` ليرى الـ api عنوان العميل الحقيقي. قفل المستخدم الموزّع (Redis) غير منفَّذ: انظر المخاطر المتبقية.

## 4) الترقية والنسخ الاحتياطي (DB-02 / OPS-01)
```bash
scripts/backup.sh /backups /path/to/uploads      # قبل أي ترقية، ويومياً بـ cron؛ BACKUP_PASSPHRASE لتشفير؛ KEEP_DAYS=30
docker compose -f docker-compose.prod.yml up -d --build     # خدمة migrate تعمل أولاً؛ فشلها (exit≠0) يمنع تشغيل api
scripts/restore.sh /backups/erpx-<stamp> erpx_restored       # تجربة استعادة دورية في قاعدة جديدة (ترفض الكتابة فوق موجودة)
```
ممنوع `docker compose down -v` على بيانات قائمة. التراجع: أوقف api، استعد النسخة في قاعدة جديدة، بدّل الاتصال. انسخ مجموعة النسخ **خارج الخادم**.
مؤشرات للتخطيط: **RPO** = الفاصل بين نسختين (يومي ⇒ حتى 24 ساعة)؛ **RTO** المقيس 2 ثانية لقاعدة 962 قيداً/637 فاتورة (الأحجام الأكبر تُقاس من جديد). تنبيه: افحص `/api/readyz` كل دقيقة (503 = قاعدة غير متاحة أو مخطط قديم) وراقب عمر آخر نسخة احتياطية.

## 5) الاختبارات
```bash
cd api && npm ci && PGUSER=... PGPASSWORD=... npm run test:all      # تقرير: reports/test-report.md
REQUIRE_ALL=1 RUN_NGINX_TESTS=1 (كمستخدم root) لتحويل SKIPPED إلى فشل في CI
```

## ما لم يُتحقق منه (يجب فعله على بيئتكم)
- `docker compose up` الفعلي وبناء الصورة (لا Docker في بيئة التطوير)، وشهادة TLS حقيقية على نطاق عام (اختُبر Nginx بشهادة ذاتية التوقيع).
- UX على متصفحات وأجهزة حقيقية: لقطات RTL على الجوال/سطح المكتب، التباين، قارئ الشاشة (الفحص الآلي هنا ثابت فقط).
- أحمال أكبر من 100 طلب متوازٍ ومليون قيد.
