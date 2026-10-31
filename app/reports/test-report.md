# OKLENT BUSINESS — test report

Started 2026-10-22T10:10:42Z — verdict **PASS**

| Suite | Result | Seconds | Detail |
|---|---|---|---|
| unit + security (no DB) | PASS | 0 | 69 checks |
| production config gate (.env.example refused) | PASS | 1 | 0 checks |
| npm audit (production deps, high+) | PASS | 0 | 0 checks |
| fresh install (all db/init files, strict) | PASS | 2 | 0 checks |
| SQL accounting rules (db_rules_test.sql) | PASS | 1 | 0 checks |
| SQL accounting integrity (db_rules_extra.sql) | PASS | 0 | 0 checks |
| migrations: fresh/upgrade/idempotent/atomic | PASS | 14 | 7 checks |
| API smoke + accounting + concurrency (smoke-test.js) | PASS | 5 | 129 checks |
| HR / payroll / custody / expenses | PASS | 1 | 29 checks |
| SEC-01 HR privacy by role | PASS | 1 | 33 checks |
| API-01 HR input validation | PASS | 0 | 32 checks |
| inventory + invoice smoke | PASS | 0 | 16 checks |
| UX static: RTL, viewport, labels, focus, motion (PARTIAL UX-01) | PASS | 1 | 17 checks |
| storefront UI (jsdom, mocked API) | PASS | 5 | 60 checks |
| product images + upload security | PASS | 2 | 18 checks |
| UI: 40 screens + write flows (jsdom) | PASS | 75 | 98 checks |
| ACC-02/T-07 concurrency + idempotency (100 parallel) | PASS | 3 | 15 checks |
| OPS-02/SEC-04 health + no secrets in logs | PASS | 1 | 9 checks |
| OPS-01 backup -> restore -> verify | PASS | 3 | 9 checks |
| nginx: headers, 429 limits, TLS redirect | PASS | 10 | 14 checks |
| UX in real browsers/devices (screenshots, contrast, screen reader) | SKIPPED | 0 | no browser in this environment: manual checklist in docs/DEPLOYMENT.md |
| Docker build / compose up / real TLS certificate | SKIPPED | 0 | needs Docker + a public host: manual steps in docs/DEPLOYMENT.md |
