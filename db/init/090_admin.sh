#!/bin/bash
# Creates the first admin from ADMIN_PASSWORD. Change it after first login.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT create_user('admin', '${ADMIN_PASSWORD:-ChangeMe!2026}', 'admin', 'مدير النظام')"
