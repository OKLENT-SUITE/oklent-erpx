#!/bin/bash
# OPS-01: consistent backup of the database (pg_dump custom format, single transaction snapshot) AND the product images (erpx_uploads).
#   PGHOST=... PGPORT=... PGUSER=erpx_owner PGPASSWORD=... [PGDATABASE=erpx] scripts/backup.sh <out-dir> [uploads-dir]
#   Optional: BACKUP_PASSPHRASE=...  -> every file is encrypted (AES-256, PBKDF2) and ends with .enc;  KEEP_DAYS=30 -> prune older sets.
# Docker (production):   docker compose -f docker-compose.prod.yml exec -T db pg_dump -U erpx_owner -Fc erpx > erpx.dump
#                        docker run --rm -v oklent-erpx-prod_erpx_uploads:/u -v $PWD:/o alpine tar czf /o/uploads.tgz -C /u .
# Copy the set OFF the host (object storage / another server). A backup that has not been restored at least once is not a backup: tests/backup-restore-test.sh.
set -Eeuo pipefail
OUT="${1:?usage: backup.sh <out-dir> [uploads-dir]}"; UPL="${2:-}"; DB="${PGDATABASE:-erpx}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; DIR="$OUT/erpx-$STAMP"; umask 077; mkdir -p "$DIR"
pg_dump -Fc --no-owner --no-privileges -d "$DB" -f "$DIR/db.dump"
[ -n "$UPL" ] && [ -d "$UPL" ] && tar czf "$DIR/uploads.tgz" -C "$UPL" .
psql -X -Atq -d "$DB" -c "SELECT json_build_object('taken_at', now(), 'schema', (SELECT value->>'version' FROM app_settings WHERE key='schema'), 'journal_entries', (SELECT count(*) FROM journal_entries), 'invoices', (SELECT count(*) FROM invoices), 'partners', (SELECT count(*) FROM partners), 'trial_balance', (SELECT sum(closing_debit)||'='||sum(closing_credit) FROM fn_trial_balance('2000-01-01','2099-12-31')))" > "$DIR/manifest.json"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then for f in "$DIR"/db.dump "$DIR"/uploads.tgz; do [ -f "$f" ] && { openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -in "$f" -out "$f.enc" && rm -f "$f"; }; done; fi
( cd "$DIR" && sha256sum * > SHA256SUMS )
[ -n "${KEEP_DAYS:-}" ] && find "$OUT" -maxdepth 1 -type d -name 'erpx-*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + || true
echo "$DIR"
