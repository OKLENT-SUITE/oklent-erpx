#!/bin/bash
# Runs once on first container start (docker-entrypoint-initdb.d). Sets the app-role password and creates the first admin.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='erpx_app') THEN CREATE ROLE erpx_app LOGIN; END IF; END \$\$;
ALTER ROLE erpx_app PASSWORD '${APP_DB_PASSWORD:-erpx_app_dev}';
SQL
