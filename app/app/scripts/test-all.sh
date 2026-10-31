#!/bin/bash
# QA-01: ONE command, one verdict.   cd api && npm run test:all      (or: bash scripts/test-all.sh)
# Needs: PostgreSQL superuser via PGHOST/PGPORT/PGUSER/PGPASSWORD (defaults: localhost:5432), psql/pg_dump, node 22 + `cd api && npm ci`. nginx (+openssl) is optional: without it the nginx suite is reported SKIPPED, never PASS.
# Creates and drops the databases erpx_ci, erpx_mig_*, erpx_restore_test. Writes reports/test-report.md and reports/test-report.json. Exit code 0 ONLY if every suite PASSES (SKIPPED does not hide a FAIL; use REQUIRE_ALL=1 to make SKIPPED a failure, as CI does).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
: "${PGUSER:?set PGUSER (a PostgreSQL superuser)}"; : "${PGPASSWORD:?set PGPASSWORD}"; export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}"
DB=erpx_ci; APP_PW=erpx_app_dev; ADMIN_PW='ChangeMe!2026'; PORT="${TEST_API_PORT:-3199}"
REP="$ROOT/reports"; mkdir -p "$REP"; LOGS="$REP/logs"; rm -rf "$LOGS"; mkdir -p "$LOGS"; : > "$REP/.rows"
START=$(date -u +%FT%TZ); FAILS=0
rec() { # name status seconds detail
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "$REP/.rows"; printf '%-52s %-8s %4ss  %s\n' "$1" "$2" "$3" "$4"; [ "$2" = FAIL ] && FAILS=$((FAILS+1)); [ "$2" = SKIPPED ] && [ -n "${REQUIRE_ALL:-}" ] && FAILS=$((FAILS+1)); return 0; }
run() { local name=$1; shift; local t0=$(date +%s); local log="$LOGS/$(echo "$name" | tr -c 'A-Za-z0-9' '_').log"; if "$@" >"$log" 2>&1; then rec "$name" PASS $(( $(date +%s)-t0 )) "$(grep -ciE '^(ok|pass)' "$log") checks"; else rec "$name" FAIL $(( $(date +%s)-t0 )) "see ${log#$ROOT/}: $(grep -E 'FAIL' "$log" | head -2 | tr '\n' ' ' | cut -c1-160)"; fi; }
cleanup() { [ -f "$REP/api.pid" ] && kill "$(cat "$REP/api.pid")" 2>/dev/null; sleep 1; psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1; }
trap cleanup EXIT
psql -X -Atq -d postgres -c "SELECT 1" >/dev/null 2>&1 || { echo "cannot connect to PostgreSQL as $PGUSER@$PGHOST:$PGPORT"; exit 2; }
unset PGDATABASE
[ -d api/node_modules/pg ] || { echo "run: cd api && npm ci"; exit 2; }
echo "== OKLENT BUSINESS test:all  $(date -u +%FT%TZ)  node $(node -v)  $(psql -V | cut -d' ' -f3) =="
# 1. no-database suites
run "unit + security (no DB)" node tests/security-unit.mjs
run "journal modal + pager (offline, mocked API)" node tests/journal-pager.mjs
run "production config gate (.env.example refused)" bash -c "! node api/src/config-check-cli.js .env.example"
run "npm audit (production deps, high+)" bash -c "cd api && npm audit --omit=dev --audit-level=high"
# 2. fresh database exactly like docker-entrypoint-initdb.d, then SQL rules
init_fresh() { psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" || return 1
  for f in db/init/*; do case $f in *.sql) psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$f" >/dev/null || { echo "FAIL init $f"; return 1; };; *.sh) POSTGRES_USER=$PGUSER POSTGRES_DB=$DB APP_DB_PASSWORD=$APP_PW ADMIN_PASSWORD="$ADMIN_PW" bash "$f" >/dev/null || { echo "FAIL init $f"; return 1; };; esac; done; }
run "fresh install (all db/init files, strict)" init_fresh
run "SQL accounting rules (db_rules_test.sql)" psql -X -q -v ON_ERROR_STOP=1 -d $DB -f tests/db_rules_test.sql
run "SQL accounting integrity (db_rules_extra.sql)" psql -X -q -v ON_ERROR_STOP=1 -d $DB -f tests/db_rules_extra.sql
run "migrations: fresh/upgrade/idempotent/atomic" bash tests/migrate-test.sh
# 3. API suites against the fresh database
export DATABASE_URL="postgres://erpx_app:$APP_PW@$PGHOST:$PGPORT/$DB" JWT_SECRET=ci-only-jwt-secret-not-for-production-use PORT=$PORT PUBLIC_RATE_LIMIT_MAX=100000 NODE_ENV=development
export OWNER_DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$DB" API_URL="http://localhost:$PORT" BASE="http://localhost:$PORT" ADMIN_PASSWORD="$ADMIN_PW" LOG_FILE="$LOGS/api-server.log"
(cd api && node src/server.js >"$LOGS/api-server.log" 2>&1 & echo $! > "$REP/api.pid"); for i in $(seq 1 30); do curl -sf "localhost:$PORT/api/livez" >/dev/null && break; sleep 0.5; done
if curl -sf "localhost:$PORT/api/readyz" >/dev/null; then
  (cd api && node src/seed-demo.js >"$LOGS/seed.log" 2>&1) || echo "seed-demo failed: see reports/logs/seed.log"
  run "API smoke + accounting + concurrency (smoke-test.js)" bash -c "cd api && LOGIN_MAX_FAILS=8 node src/smoke-test.js"
  run "HR / payroll / custody / expenses" node tests/hr-smoke.mjs
  run "SEC-01 HR privacy by role" node tests/hr-privacy.mjs
  run "API-01 HR input validation" node tests/hr-validation.mjs
  run "inventory + invoice smoke" node tests/inventory-invoice-smoke.mjs
  run "UX static: RTL, viewport, labels, focus, motion (PARTIAL UX-01)" node tests/ux-static.mjs
  run "storefront UI (jsdom, mocked API)" node tests/shop-smoke.mjs
  run "product images + upload security" node tests/products-image-smoke.mjs
  run "UI: 40 screens + write flows (jsdom)" node tests/ui-smoke.mjs
  run "ACC-02/T-07 concurrency + idempotency (100 parallel)" env CONC=100 node tests/concurrency.mjs
  run "OPS-02/SEC-04 health + no secrets in logs" node tests/ops-check.mjs
  run "OPS-01 backup -> restore -> verify" env SRC_DB=$DB bash tests/backup-restore-test.sh
else rec "API start (readyz)" FAIL 0 "the api did not become ready: see reports/logs/api-server.log"; fi
kill "$(cat "$REP/api.pid")" 2>/dev/null; rm -f "$REP/api.pid"; sleep 1
# 4. nginx (HTTP rules, rate limits, TLS) — needs a local nginx + openssl and root (it writes /etc/nginx/erpx-*.conf)
if command -v nginx >/dev/null && command -v openssl >/dev/null && [ "$(id -u)" = 0 ] && [ -n "${RUN_NGINX_TESTS:-}" ]; then
  (cd api && PORT=3100 node src/server.js >"$LOGS/api-nginx.log" 2>&1 & echo $! > "$REP/api.pid"); sleep 3; run "nginx: headers, 429 limits, TLS redirect" bash tests/nginx-live.sh; kill "$(cat "$REP/api.pid")" 2>/dev/null; rm -f "$REP/api.pid"
else rec "nginx: headers, 429 limits, TLS redirect" SKIPPED 0 "set RUN_NGINX_TESTS=1 as root with nginx+openssl installed (tests/nginx-live.sh)"; fi
rec "UX in real browsers/devices (screenshots, contrast, screen reader)" SKIPPED 0 "no browser in this environment: manual checklist in docs/DEPLOYMENT.md"
rec "Docker build / compose up / real TLS certificate" SKIPPED 0 "needs Docker + a public host: manual steps in docs/DEPLOYMENT.md"
# 5. report
python3 - "$REP" "$START" "$FAILS" <<'PY'
import sys,json,datetime
rep,start,fails=sys.argv[1],sys.argv[2],int(sys.argv[3]); rows=[l.rstrip('\n').split('\t') for l in open(rep+'/.rows',encoding='utf8') if l.strip()]
data={'started':start,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'verdict':'FAIL' if fails else 'PASS','suites':[dict(zip(['name','status','seconds','detail'],r)) for r in rows]}
json.dump(data,open(rep+'/test-report.json','w',encoding='utf8'),ensure_ascii=False,indent=1)
md=['# OKLENT BUSINESS — test report','',f'Started {start} — verdict **{data["verdict"]}**','','| Suite | Result | Seconds | Detail |','|---|---|---|---|']+[f'| {r[0]} | {r[1]} | {r[2]} | {r[3]} |' for r in rows]
open(rep+'/test-report.md','w',encoding='utf8').write('\n'.join(md)+'\n')
PY
rm -f "$REP/.rows"; echo "== verdict: $([ $FAILS -eq 0 ] && echo PASS || echo "FAIL ($FAILS)")  — reports/test-report.md"; exit $([ $FAILS -eq 0 ] && echo 0 || echo 1)
