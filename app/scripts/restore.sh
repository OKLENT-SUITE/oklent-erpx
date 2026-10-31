#!/bin/bash
# OPS-01: restore a set made by scripts/backup.sh into a NEW database (never overwrites an existing one) and verify it.
#   PGHOST=... PGUSER=<superuser> PGPASSWORD=... [BACKUP_PASSPHRASE=...] scripts/restore.sh <backup-set-dir> <new-db-name> [uploads-target-dir]
# After a successful restore: point the api at <new-db-name> (or rename databases during a maintenance window), then sign in and check the dashboard.
set -Eeuo pipefail
SET="${1:?usage: restore.sh <backup-set-dir> <new-db-name> [uploads-target-dir]}"; NEW="${2:?new db name}"; UPL="${3:-}"
[[ "$NEW" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "invalid database name"; exit 2; }
( cd "$SET" && sha256sum -c SHA256SUMS >/dev/null ) || { echo "CHECKSUM MISMATCH: the backup set is corrupt or incomplete"; exit 3; }
[ "$(psql -X -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname='$NEW'")" = 0 ] || { echo "database $NEW already exists: refusing to overwrite"; exit 4; }
dec() { local f=$1; if [ -f "$f.enc" ]; then openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$f.enc"; else cat "$f"; fi; }
psql -X -q -d postgres -c "CREATE DATABASE $NEW"
# roles are cluster-wide: erpx_app must exist (it does on the same cluster / after init). Create it if restoring onto a fresh server.
psql -X -q -d postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='erpx_app') THEN CREATE ROLE erpx_app LOGIN; END IF; END \$\$"
dec "$SET/db.dump" | pg_restore --no-owner --exit-on-error -d "$NEW"
if [ -n "$UPL" ] && { [ -f "$SET/uploads.tgz" ] || [ -f "$SET/uploads.tgz.enc" ]; }; then mkdir -p "$UPL"; dec "$SET/uploads.tgz" | tar xzf - -C "$UPL"; fi
# grants are not part of --no-privileges dumps: re-apply the idempotent least-privilege grants, then verify the books
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; for f in 070_privileges.sql 175_grants.sql 185_hr_grants.sql 210_idempotency.sql; do [ -f "$ROOT/db/init/$f" ] && psql -X -q -v ON_ERROR_STOP=1 -d "$NEW" -f "$ROOT/db/init/$f" >/dev/null; done
psql -X -Atq -d "$NEW" -c "SELECT CASE WHEN (SELECT bool_and(ok) FROM verify_chain() ok) THEN 'hash chain OK' ELSE 'HASH CHAIN BROKEN' END" | tee /dev/stderr | grep -q "chain OK" || { echo "RESTORE VERIFICATION FAILED"; exit 5; }
echo "restored into $NEW"
