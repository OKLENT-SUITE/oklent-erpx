#!/bin/bash
# Per-company backup / restore (multi-tenant). Uses pg_dump -n <schema>: ONE company, in a custom-format file, optionally encrypted (same BACKUP_PASSPHRASE as scripts/backup.sh).
#   scripts/tenant-backup.sh backup  acme   [/path/out.dump]
#   scripts/tenant-backup.sh restore acme   /path/in.dump        # restores into the SAME schema name; the schema must NOT exist (archive/drop it first)
# Needs PGHOST/PGPORT/PGUSER (owner) /PGPASSWORD and PGDATABASE (default erpx).
set -euo pipefail
cmd=${1:?backup|restore}; slug=${2:?company slug}; file=${3:-}
[[ "$slug" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]] || { echo "invalid slug"; exit 2; }
schema="t_${slug//-/_}"; db=${PGDATABASE:-erpx}
case "$cmd" in
  backup)  out=${file:-"tenant-${slug}-$(date -u +%Y%m%dT%H%M%SZ).dump"}
           pg_dump -Fc -n "$schema" -d "$db" -f "$out"
           if [ -n "${BACKUP_PASSPHRASE:-}" ]; then openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -in "$out" -out "$out.enc" && rm "$out" && out="$out.enc"; fi
           echo "backup written: $out ($(du -h "$out" | cut -f1))";;
  restore) [ -f "$file" ] || { echo "file not found"; exit 2; }
           in=$file; if [[ "$file" == *.enc ]]; then in=$(mktemp); trap 'rm -f "$in"' EXIT; openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" -out "$in"; fi
           psql -X -Atq -d "$db" -c "SELECT 1 FROM information_schema.schemata WHERE schema_name='$schema'" | grep -q 1 && { echo "schema $schema already exists: archive and DROP it first"; exit 3; }
           pg_restore -d "$db" --no-owner --exit-on-error "$in"
           psql -X -q -d "$db" -c "UPDATE platform.tenants SET status='active', last_error=NULL WHERE schema_name='$schema'" || true
           echo "restored $schema";;
  *) echo "backup|restore"; exit 2;;
esac
