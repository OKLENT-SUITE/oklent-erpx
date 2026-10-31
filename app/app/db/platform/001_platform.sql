-- OKLENT BUSINESS | multi-tenant control plane (schema "platform") | idempotent: safe to run on every migrate.
-- One row per customer (tenant). The customer's accounting data lives in its OWN schema (tenants.schema_name); the default row
-- (is_default) points at "public", i.e. an install that existed before multi-tenancy keeps its data exactly where it is.
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.tenants (
  id                  serial PRIMARY KEY,
  slug                text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$'),
  name                text NOT NULL,
  schema_name         text NOT NULL UNIQUE CHECK (schema_name = 'public' OR schema_name ~ '^t_[a-z0-9_]+$'),
  status              text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning','active','suspended','archived','failed')),
  is_default          boolean NOT NULL DEFAULT false,
  plan                text NOT NULL DEFAULT 'standard',
  max_users           int CHECK (max_users IS NULL OR max_users > 0),
  custom_domain       text UNIQUE CHECK (custom_domain IS NULL OR custom_domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
  contact_email       text,
  data_region         text NOT NULL DEFAULT 'sa',                 -- where the tenant's data is hosted (data-residency evidence)
  provisioned_version text,                                       -- schema version last applied by migrate / tenant-cli
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  activated_at        timestamptz,
  suspended_at        timestamptz,
  suspended_reason    text
);
-- exactly one default tenant (the legacy "public" data), never two
CREATE UNIQUE INDEX IF NOT EXISTS tenants_one_default ON platform.tenants ((true)) WHERE is_default;

CREATE TABLE IF NOT EXISTS platform.tenant_events (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  tenant_id  int REFERENCES platform.tenants(id),
  event      text NOT NULL,
  actor      text NOT NULL,
  detail     jsonb
);
CREATE INDEX IF NOT EXISTS tenant_events_tenant_idx ON platform.tenant_events (tenant_id, at DESC);

-- The API (role erpx_app) may only READ the registry. Creating, suspending or upgrading tenants needs the owner role (tenant-cli.js),
-- which the API container never holds in production (see assertProductionSecrets).
GRANT USAGE ON SCHEMA platform TO erpx_app;
GRANT SELECT ON platform.tenants TO erpx_app;
REVOKE ALL ON platform.tenant_events FROM erpx_app;
