#!/bin/bash
# Proves the migration runner upgrades OLD databases and is idempotent.
# Needs a local PostgreSQL superuser, e.g.:
#   PGHOST=localhost PGUSER=erpx_owner PGPASSWORD=... OWNER_URL_PREFIX=postgres://erpx_owner:...@localhost:5432 tests/migrate-test.sh
# (creates and drops the databases erpx_mig_early and erpx_mig_prev)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="${OWNER_URL_PREFIX:?set OWNER_URL_PREFIX, e.g. postgres://erpx_owner:pw@localhost:5432}"
mkdb() { db=$1; shift; psql -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null; for f in "$@"; do psql -q -d "$db" -f "$f" >/dev/null 2>&1 || true; done; }
run() { OWNER_DATABASE_URL="$PREFIX/$1" ERPX_ROOT="$ROOT" node "$ROOT/api/src/migrate.js" 2>&1; }
check() { # db label files-that-must-be-applied
  out=$(run "$1")
  for f in $3; do echo "$out" | grep -q "applying $f" || { echo "FAIL $2: expected to apply $f"; echo "$out"; exit 1; }; done
  echo "$out" | grep -q "PROBLEM" && { echo "FAIL $2: problem reported"; echo "$out"; exit 1; }
  run "$1" | grep -q "0 applied" || { echo "FAIL $2: second run is not a no-op"; exit 1; }
  echo "ok   $2"; }
mkdb erpx_mig_early $ROOT/db/init/0*.sql $ROOT/db/init/100_*.sql $ROOT/db/init/110_*.sql   # created BEFORE the platform migration (no technicians / stock / bookings)
check erpx_mig_early "database from before the platform migration is brought up to date" "120_platform.sql 125_geo_saudi.sql 140_menu_settings.sql 160_fixes_0_5.sql"
mkdb erpx_mig_prev $(ls $ROOT/db/init/*.sql | grep -v 160_fixes)                           # previous release: everything except 160
check erpx_mig_prev "previous release gets only 160" "160_fixes_0_5.sql"
psql -q -d postgres -c "DROP DATABASE erpx_mig_early" -c "DROP DATABASE erpx_mig_prev" >/dev/null
echo "ALL MIGRATION CHECKS PASSED"
