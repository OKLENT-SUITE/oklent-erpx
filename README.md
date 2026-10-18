# OKLENT-ERPX — Saudi accounting engine + property management (MIT)

PostgreSQL-enforced double entry · multi-currency · period closing · VAT · ZATCA e-invoice (Phase 1 + chain) · Saudi COA · Arabic RTL web/PWA · REST API · CLI · Rules Lab · SOP & FAQ.
**© 2026 OKLENT BUSINESS. جميع الحقوق محفوظة**

## Run locally (Docker Desktop, Windows/macOS/Linux)
```bash
copy .env.example .env        # (cp on Linux/macOS) then edit passwords
docker compose up -d --build
docker compose exec api node api/src/seed-demo.js   # demo data through the real engine (optional)
```
Open http://localhost:3100 · login `admin` / the `ADMIN_PASSWORD` (default `ChangeMe!2026`).
Ports: web 3100 (nginx → api, which is internal), PostgreSQL 5434 on 127.0.0.1 only (chosen to avoid 5432 and 5433).
Production: set `NODE_ENV=production` with a `JWT_SECRET` ≥ 32 random characters and a strong `APP_DB_PASSWORD`; otherwise the API refuses to start.
> The DB init scripts run **only on first start** of a volume. Since 0.6.0 the one-shot `migrate` service upgrades an existing volume automatically on every `docker compose up -d --build` (adds missing tables, keeps data). To rebuild a DEMO database from scratch: `reset-demo.cmd` (or `docker compose down -v`).

## Without Docker
`psql` each file in `db/init/*.sql` in order (as owner), set the `erpx_app` password, `select create_user('admin','pw','admin','Admin')`, then `cd api && npm i && DATABASE_URL=... node src/server.js`.

## Upgrading
From 0.3.x (keeps your data): `docker compose up -d --build` — see CHANGELOG 0.4.0 (a new `web` service is created).

From 0.2.0 (keeps your data): see `CHANGELOG.md` (apply `125_geo_saudi.sql` and `140_menu_settings.sql`, then `docker compose up -d --build api`).

For older versions or a clean demo start:
This version changes demo data and renames things (neutral store, unit types, regions/cities, bookings, stock). The database init scripts run only on the first start, so for the demo database use a clean start:
```bash
docker compose down -v          # deletes the demo database and its volume
docker compose up -d --build    # rebuilds everything from db/init/*.sql (includes the demo store, products with stock, technicians)
docker compose exec -e ADMIN_PASSWORD=your-admin-password api node api/src/seed-demo.js   # optional: invoices, leases, owners, vendor bills
```
For a database that already holds real data, apply `db/init/100…130_*.sql` once each in order (as owner) and review the renames in `120_platform.sql` first; do not run them twice.

Storefront: `http://localhost:3100/shop/store`.

## Logo
`web/logo.svg` is a placeholder Oklent mark (used in the sidebar, login, favicon, PWA). Replace it with the official logo file (same name) and regenerate `web/icon-192.png` / `icon-512.png` for the Play Store.

## CLI
`node cli/oklentx.js login --user admin --password ...` then `tb`, `is`, `bs`, `gl --account 1121`, `post --file entry.json`, `close <id>`, `verify`, `try unbalanced`.

## Upgrade to 0.2.0 (keeps your data)
```bash
docker compose up -d --build api      # API/UI only: no SQL migration, no `down -v`
```
On start the API fills blank storefront settings and publishes a site only if it passes the readiness checklist (Store settings → ٣).

## Tests
- `cd api && npm run test:unit` — secrets, sign-in throttle, markdown sanitiser, CSP/nginx consistency, nav.json integrity (no database needed).
- `cd api && npm i --no-save jsdom && npm run test:ui` — opens every sub-menu and the store/product save flows against a running API.
- `psql -d erpx -f tests/db_rules_test.sql` — 28 rule tests (rolled back).
- `cd api && npm test` — API, concurrency (40 postings, 10 invoices), gapless numbering, hash chain.

## Architecture
`browser → nginx (web, :3100) → Fastify REST (api, internal)`; `web (PWA) / CLI → Fastify REST (JWT, roles) → erpx_app role → SECURITY DEFINER functions → triggers & constraints → PostgreSQL`.
Rules live in `db/init/030_rules.sql`; the only doors into the ledger are in `040_functions.sql`.

## Status — read before using for real money
Engine rules tested; **ZATCA Phase 2 (signing, CSID, clearance/reporting) is NOT implemented** (docs/ZATCA.md). Security review, backup/restore drill, load test and accountant sign-off are required before production.
