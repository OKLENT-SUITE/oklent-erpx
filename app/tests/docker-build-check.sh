#!/bin/bash
# Docker build verification (defect #8). Needs Docker; test-all.sh runs it automatically when Docker is present, otherwise it reports SKIPPED.
#   bash tests/docker-build-check.sh            (does NOT need a public host: real TLS is checked by docs/QA_MANUAL.md)
set -uo pipefail
cd "$(dirname "$0")/.."; fail=0; ok() { echo "ok   $1"; }; bad() { echo "FAIL $1"; fail=1; }
docker build -q -t oklent-business:check . >/dev/null 2>&1 && ok "image builds from package-lock (npm ci)" || { bad "docker build failed"; exit 1; }
[ "$(docker run --rm --entrypoint id oklent-business:check -u)" != "0" ] && ok "runs as a non-root user" || bad "container runs as root"
docker run --rm --entrypoint sh oklent-business:check -c 'test -f db/schema-expected.json && test -f db/platform/001_platform.sql && test -f api/src/tenant-cli.js && command -v openssl >/dev/null' && ok "image contains schema-expected.json, platform SQL, tenant-cli and openssl" || bad "image misses runtime files"
docker run --rm --entrypoint sh oklent-business:check -c 'test -f web/legal/privacy.html && test -f docs/ZATCA.md' && ok "legal pages and docs are in the image" || bad "legal pages missing"
docker compose config -q 2>/dev/null && ok "docker-compose.yml is valid" || bad "docker-compose.yml invalid"
OWNER_DB_PASSWORD=Hn4Rt8Wq2Lz6Xc9Vb3Mp APP_DB_PASSWORD=Zp8wQ3rLm7TxV2nYk5Dg ADMIN_PASSWORD=Jr5Kd9Fs2Gh7Lm4Qw8Xz JWT_SECRET=k9Qv3xLw8ZpR2mTn7YbH5cJd1FgS4aUe6VoXiNz0 docker compose -f docker-compose.prod.yml config -q 2>/dev/null && ok "docker-compose.prod.yml is valid with real secrets" || bad "docker-compose.prod.yml invalid"
docker compose -f docker-compose.prod.yml --profile admin config --services 2>/dev/null | grep -q tenant-admin && ok "tenant-admin service is defined (profile admin)" || bad "tenant-admin service missing"
exit $fail
