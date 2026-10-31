#!/bin/bash
# DB-01 / DB-02 / T-03 / T-04 — strict migration tests. NOTHING is ignored: any SQL error in ANY step stops the run immediately,
# naming the file and the error. (The previous version ran every file with `|| true` and called a module that prints nothing.)
#
#   PGHOST=localhost PGPORT=5432 PGUSER=<superuser> PGPASSWORD=... tests/migrate-test.sh
# Creates and drops the databases erpx_mig_* (never touches any other database). Needs psql, node (api/node_modules installed).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${PGHOST:?set PGHOST}"; : "${PGUSER:?set PGUSER}"; : "${PGPASSWORD:?set PGPASSWORD}"; PGPORT="${PGPORT:-5432}"
export PGHOST PGPORT PGUSER PGPASSWORD
URL() { echo "postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$1"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"; for d in $DBS; do psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $d" >/dev/null 2>&1 || true; done' EXIT
DBS="erpx_mig_fresh erpx_mig_early erpx_mig_prev erpx_mig_prev2 erpx_mig_fail erpx_mig_bad"
fail() { echo "FAIL $*"; exit 1; }
ok() { echo "ok   $*"; }

# apply_file <db> <file> : ONE file, single transaction, ON_ERROR_STOP. Returns non-zero (and prints the file + error) on ANY error.
apply_file() {
  local db=$1 f=$2 out
  case "$f" in
    *.sql) out=$(psql -X -q -v ON_ERROR_STOP=1 -1 -d "$db" -f "$f" 2>&1) || { echo "SQL ERROR in $(basename "$f"): $out" | head -8; return 1; } ;;
    *.sh)  out=$(POSTGRES_USER="$PGUSER" POSTGRES_DB="$db" APP_DB_PASSWORD="erpx_app_dev" ADMIN_PASSWORD="Mig-Test-Pw-2026!" PGDATABASE="$db" bash "$f" 2>&1) || { echo "SCRIPT ERROR in $(basename "$f"): $out" | head -8; return 1; } ;;
  esac
}
mkdb() { local db=$1; shift; psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null
  for f in "$@"; do apply_file "$db" "$f" || fail "building $db stopped at $(basename "$f")"; done; }
# fingerprint: structure (tables+columns+types, functions, triggers) — must not change on a re-run
fp() { psql -X -Atq -d "$1" -c "SELECT md5(coalesce((SELECT string_agg(table_name||'.'||column_name||':'||data_type, ',' ORDER BY table_name, column_name) FROM information_schema.columns WHERE table_schema='public'),'') ||
  coalesce((SELECT string_agg(p.proname||md5(p.prosrc), ',' ORDER BY p.proname, p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),'') ||
  coalesce((SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE NOT tgisinternal),''))"; }
# business-data fingerprint: row counts + trial balance of the data that existed BEFORE the upgrade
# (accounts are compared separately: an upgrade may ADD chart-of-accounts rows, but must never lose or change an existing one)
data_fp() { psql -X -Atq -d "$1" -c "SELECT (SELECT count(*) FROM journal_entries)||'/'||(SELECT count(*) FROM journal_lines)||'/'||(SELECT count(*) FROM partners)||'/'||
  coalesce((SELECT sum(closing_debit)||'='||sum(closing_credit) FROM fn_trial_balance('2000-01-01','2099-12-31')),'none')"; }
# run_migrate <db> [root] : the REAL runner (migrate-cli.js); returns its output; fails on upgrade failure / missing schema parts
run_migrate() { local out rc=0; out=$(OWNER_DATABASE_URL="$(URL "$1")" ERPX_ROOT="${2:-$ROOT}" node "$ROOT/api/src/migrate-cli.js" 2>&1) || rc=$?; echo "$out"; return $rc; }

INIT=("$ROOT"/db/init/*)   # docker-entrypoint-initdb.d order: .sql and .sh, alphabetical

echo "== S0 self-test: the harness must FAIL on invalid SQL (proves nothing is swallowed)"
printf 'CREATE TABLE ok_t(i int);\nSELECT * FROM definitely_missing_table;\n' > "$TMP/bad.sql"
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS erpx_mig_bad" -c "CREATE DATABASE erpx_mig_bad" >/dev/null
if msg=$(apply_file erpx_mig_bad "$TMP/bad.sql"); then fail "S0: invalid SQL was NOT detected"; fi
echo "$msg" | grep -q "bad.sql" || fail "S0: error did not name the file: $msg"
[ "$(psql -X -Atq -d erpx_mig_bad -c "SELECT to_regclass('ok_t') IS NULL")" = t ] || fail "S0: the failing file was not rolled back as a whole"
ok "S0 invalid SQL is detected, names the file, and is rolled back"

echo "== T-04 fresh empty database: every init file applies with no error; schema complete; re-run is a no-op"
mkdb erpx_mig_fresh "${INIT[@]}"
out=$(run_migrate erpx_mig_fresh) || fail "T-04 migrate on fresh db: $out"
echo "$out" | grep -q "database already up to date" || fail "T-04 fresh db should need no upgrade: $out"
echo "$out" | grep -q "schema check: all expected tables and columns exist" || fail "T-04 schema-expected.json mismatch: $out"
f1=$(fp erpx_mig_fresh); run_migrate erpx_mig_fresh >/dev/null; [ "$f1" = "$(fp erpx_mig_fresh)" ] || fail "T-04 re-run changed the structure"
ok "T-04 fresh database complete and stable"

# helper: build an OLD database, put business data in it, upgrade it twice, prove data + structure + idempotency
upgrade_case() { # db label files...
  local db=$1 label=$2; shift 2
  mkdb "$db" "$@"
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "SELECT set_config('erpx.user','mig-test',false)" -c "SELECT post_entry('2026-03-05','pre-upgrade sale',NULL,'manual',NULL,'mig-test','[{\"account\":\"1110\",\"debit\":250},{\"account\":\"4200\",\"credit\":250}]')" \
    -c "INSERT INTO partners(kind,name_ar) VALUES ('customer','عميل قبل الترقية')" >/dev/null || fail "$label: cannot create pre-upgrade business data"
  local before; before=$(data_fp "$db")
  local codes; codes=$(psql -X -Atq -d "$db" -c "SELECT string_agg(code,',' ORDER BY code) FROM accounts")
  local accfp; accfp=$(psql -X -Atq -d "$db" -c "SELECT md5(string_agg(code||name_ar||type||is_postable::text, '|' ORDER BY code)) FROM accounts")
  out=$(run_migrate "$db") || fail "$label: migrate failed: $out"
  echo "$out" | grep -q "DATABASE UPGRADE FAILED\|SCHEMA CHECK: still missing" && fail "$label: $out"
  echo "$out" | grep -q "database upgraded automatically" || fail "$label: expected an automatic upgrade: $out"
  local after; after=$(data_fp "$db"); [ "$before" = "$after" ] || fail "$label: business data changed by the upgrade ($before -> $after)"
  [ "$(psql -X -Atq -d "$db" -c "SELECT md5(string_agg(code||name_ar||type||is_postable::text, '|' ORDER BY code)) FROM accounts WHERE code = ANY(string_to_array('$codes', ','))")" = "$accfp" ] || fail "$label: an existing account was lost or changed by the upgrade"
  local f1; f1=$(fp "$db"); out2=$(run_migrate "$db") || fail "$label: 2nd migrate failed: $out2"
  echo "$out2" | grep -q "database already up to date" || fail "$label: second run is not a no-op: $out2"
  [ "$f1" = "$(fp "$db")" ] || fail "$label: second run changed the structure"
  [ "$f1" = "$(fp erpx_mig_fresh)" ] || fail "$label: upgraded structure differs from a FRESH install (drift)"
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$ROOT/tests/db_rules_test.sql" >/dev/null 2>"$TMP/r1.err" || fail "$label: db_rules_test.sql failed on the upgraded database: $(head -3 "$TMP/r1.err")"
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$ROOT/tests/db_rules_extra.sql" >/dev/null 2>"$TMP/r2.err" || fail "$label: db_rules_extra.sql failed on the upgraded database: $(head -3 "$TMP/r2.err")"
  ok "$label (data kept: $before; idempotent; identical to a fresh install; SQL rule tests pass)"
}
echo "== T-03 upgrade from older databases"
upgrade_case erpx_mig_early "early: database from before the platform migration" "$ROOT"/db/init/0*.sql "$ROOT"/db/init/100_*.sql "$ROOT"/db/init/110_*.sql
upgrade_case erpx_mig_prev  "release 1.2.x: everything except 200_inventory_costing, 210_idempotency, 220_fleet, 230_ai, and 240_account_profile" $(ls "$ROOT"/db/init/*.sql | grep -vE '/(200|210|220|230|240)_')
upgrade_case erpx_mig_prev2 "release 1.3.0 (schema 0.9.0): everything except 210_idempotency, 220_fleet, and 230_ai" $(ls "$ROOT"/db/init/*.sql | grep -vE '/(210|220|230)_')

echo "== DB-02 a failing migration step is atomic and reported (copy of the tree with a broken 200 file)"
cp -r "$ROOT/db" "$TMP/dbcopy" && mkdir -p "$TMP/rootcopy" && mv "$TMP/dbcopy" "$TMP/rootcopy/db"
printf '\nSELECT * FROM table_that_does_not_exist;\n' >> "$TMP/rootcopy/db/init/200_inventory_costing_invoice_lines.sql"
mkdb erpx_mig_fail $(ls "$ROOT"/db/init/*.sql | grep -vE '/(200|210|220|230)_')
before=$(data_fp erpx_mig_fail); rc=0; out=$(run_migrate erpx_mig_fail "$TMP/rootcopy") || rc=$?
[ "$rc" -ne 0 ] || fail "DB-02: migrate-cli exited 0 on a failed upgrade (docker compose would start the api): $out"
echo "$out" | grep -q "DATABASE UPGRADE FAILED" || fail "DB-02: failure not reported: $out"
[ "$(psql -X -Atq -d erpx_mig_fail -c "SELECT to_regclass('product_costing') IS NULL")" = t ] || fail "DB-02: the failed file left partial objects behind"
[ "$before" = "$(data_fp erpx_mig_fail)" ] || fail "DB-02: data changed by a failed migration"
ok "DB-02 failed upgrade: non-zero exit, clear message, nothing partial, data intact"

echo "== DB-02 the API refuses to pretend: stale schema is reported by /api/health and endpoints answer 503, not 500/crash"
if [ -n "${SKIP_API_STALE:-}" ]; then echo "SKIPPED stale-schema API check (SKIP_API_STALE set)"; else
  PORT=3187 DATABASE_URL="postgres://erpx_app:erpx_app_dev@$PGHOST:$PGPORT/erpx_mig_fail" JWT_SECRET=dev-only-change-me NODE_ENV=development node "$ROOT/api/src/server.js" >"$TMP/api.log" 2>&1 & apid=$!
  sleep 3; h=$(curl -s -m 5 localhost:3187/api/health || true); live=$(curl -s -m 5 -o /dev/null -w '%{http_code}' localhost:3187/api/livez || true); ready=$(curl -s -m 5 -o /dev/null -w '%{http_code}' localhost:3187/api/readyz || true)
  kill $apid 2>/dev/null || true; wait $apid 2>/dev/null || true
  [ "$live" = 200 ] || fail "OPS-02: livez must answer 200 even on an outdated schema (got $live)"; [ "$ready" = 503 ] || fail "OPS-02: readyz must answer 503 on an outdated schema (got $ready)"
  echo "$h" | grep -q '"schema":"ok"' && fail "DB-02: health reports schema ok on an outdated database: $h"
  echo "$h" | grep -q '"schema"' || fail "DB-02: health did not answer: $h $(tail -3 "$TMP/api.log")"
  ok "DB-02 outdated schema is visible in health ($h)"
fi
echo "ALL MIGRATION CHECKS PASSED"
