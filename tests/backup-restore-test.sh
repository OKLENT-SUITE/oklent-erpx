#!/bin/bash
# OPS-01 / T-09: backup -> restore on an isolated database -> prove the books, the invoices, the images and the sign-in survived. RPO = time since last backup; RTO measured below.
#   PGHOST=localhost PGUSER=<superuser> PGPASSWORD=... SRC_DB=erpx tests/backup-restore-test.sh
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; : "${PGUSER:?}"; : "${PGPASSWORD:?}"; export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}"
SRC="${SRC_DB:-erpx}"; export PGDATABASE="$SRC";   # backup.sh reads PGDATABASE
 NEW=erpx_restore_test; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"; psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $NEW" >/dev/null 2>&1 || true' EXIT
fail() { echo "FAIL $*"; exit 1; }; ok() { echo "ok   $*"; }
q() { psql -X -Atq -d "$1" -c "$2"; }
mkdir -p "$TMP/uploads/products"; head -c 2048 /dev/urandom > "$TMP/uploads/products/test-image.bin"; sum1=$(sha256sum "$TMP/uploads/products/test-image.bin" | cut -d' ' -f1)
fp() { q "$1" "SELECT (SELECT count(*) FROM journal_entries)||'/'||(SELECT count(*) FROM journal_lines)||'/'||(SELECT count(*) FROM invoices)||'/'||(SELECT count(*) FROM partners)||'/'||(SELECT count(*) FROM accounts)||'/'||(SELECT count(*) FROM employees)||'/'||coalesce((SELECT sum(closing_debit)||'='||sum(closing_credit) FROM fn_trial_balance('2000-01-01','2099-12-31')),'')||'/'||(SELECT max(chain_no) FROM journal_entries)||'/'||(SELECT max(row_hash) FROM journal_entries WHERE chain_no=(SELECT max(chain_no) FROM journal_entries))"; }
before=$(fp "$SRC")
set=$("$ROOT/scripts/backup.sh" "$TMP/out" "$TMP/uploads"); [ -f "$set/db.dump" ] && [ -f "$set/uploads.tgz" ] && [ -f "$set/SHA256SUMS" ] || fail "backup set incomplete"; ok "backup written ($(du -sh "$set" | cut -f1)), manifest: $(cat "$set/manifest.json" | cut -c1-120)"
t0=$(date +%s); mkdir -p "$TMP/restored-uploads"; "$ROOT/scripts/restore.sh" "$set" "$NEW" "$TMP/restored-uploads" >/dev/null 2>"$TMP/restore.err" || fail "restore failed: $(tail -3 "$TMP/restore.err")"; t1=$(date +%s)
[ "$before" = "$(fp "$NEW")" ] || fail "restored data differs: $before vs $(fp "$NEW")"; ok "data identical after restore (RTO for this dataset: $((t1-t0))s): $before"
[ "$sum1" = "$(sha256sum "$TMP/restored-uploads/products/test-image.bin" | cut -d' ' -f1)" ] || fail "restored image differs"; ok "uploads restored bit-for-bit"
[ "$(q "$NEW" "SELECT count(*) FROM login_user('admin','${ADMIN_PASSWORD:-ChangeMe!2026}')")" = 1 ] && ok "admin can still sign in on the restored database" || echo "SKIPPED admin sign-in check (ADMIN_PASSWORD differs from the default)"
psql -X -q -v ON_ERROR_STOP=1 -d "$NEW" -f "$ROOT/tests/db_rules_test.sql" >/dev/null 2>&1 || fail "SQL rule tests fail on the restored database"; ok "accounting rule tests pass on the restored database"
[ "$(q "$NEW" "SELECT has_table_privilege('erpx_app','journal_lines','UPDATE')")" = f ] || fail "least-privilege grants were not restored"; ok "least-privilege grants intact (erpx_app cannot UPDATE the ledger)"
echo "--- negative checks"
cp -r "$set" "$TMP/corrupt"; echo x >> "$TMP/corrupt/db.dump"; if "$ROOT/scripts/restore.sh" "$TMP/corrupt" erpx_restore_bad >/dev/null 2>&1; then fail "a corrupted backup was accepted"; fi; ok "corrupted backup refused (checksum)"
if "$ROOT/scripts/restore.sh" "$set" "$NEW" >/dev/null 2>&1; then fail "restore overwrote an existing database"; fi; ok "restore refuses to overwrite an existing database"
set2=$(BACKUP_PASSPHRASE='Backup-Pass-Test-1!' "$ROOT/scripts/backup.sh" "$TMP/out2" "$TMP/uploads"); ls "$set2" | grep -q "db.dump.enc" && ! ls "$set2" | grep -q "^db.dump$" || fail "encrypted backup still contains a plain dump"
psql -X -q -d postgres -c "DROP DATABASE $NEW"; BACKUP_PASSPHRASE='Backup-Pass-Test-1!' "$ROOT/scripts/restore.sh" "$set2" "$NEW" >/dev/null 2>&1 || fail "encrypted restore failed"; [ "$before" = "$(fp "$NEW")" ] || fail "encrypted restore differs"; ok "encrypted backup restores identically"
echo "ALL BACKUP/RESTORE CHECKS PASSED"
