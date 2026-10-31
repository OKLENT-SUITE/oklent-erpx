-- 290 (schema 0.16.0): two-factor authentication (TOTP). Idempotent; runs in public AND, translated, in every tenant schema.
-- The API role can neither read nor write these columns: it reaches them only through the SECURITY DEFINER functions below
-- (same pattern as login_user / change_password). The secret is stored encrypted by the API (AES-256-GCM); recovery codes only as SHA-256.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled     boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step   bigint;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery    text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enrolled_at timestamptz;

CREATE OR REPLACE FUNCTION totp_state(p_username text) RETURNS TABLE(enabled boolean, pending boolean, secret_enc text, last_step bigint, recovery_left int)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.totp_enabled, (NOT u.totp_enabled AND u.totp_secret_enc IS NOT NULL), u.totp_secret_enc, u.totp_last_step, coalesce(cardinality(u.totp_recovery),0)
  FROM users u WHERE u.username = p_username AND u.is_active $$;

-- start (or restart) enrolment: only while 2FA is NOT yet enabled; an enabled account must be disabled with a valid code first
CREATE OR REPLACE FUNCTION totp_begin(p_username text, p_secret_enc text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (UPDATE users SET totp_secret_enc = p_secret_enc, totp_last_step = NULL, totp_recovery = '{}'
             WHERE username = p_username AND is_active AND NOT totp_enabled RETURNING 1) SELECT EXISTS (SELECT 1 FROM u) $$;

CREATE OR REPLACE FUNCTION totp_confirm(p_username text, p_step bigint, p_recovery text[]) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (UPDATE users SET totp_enabled = true, totp_last_step = p_step, totp_recovery = p_recovery, totp_enrolled_at = now()
             WHERE username = p_username AND is_active AND NOT totp_enabled AND totp_secret_enc IS NOT NULL RETURNING 1) SELECT EXISTS (SELECT 1 FROM u) $$;

-- atomic replay guard: succeeds only if p_step is newer than the last accepted one
CREATE OR REPLACE FUNCTION totp_advance(p_username text, p_step bigint) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (UPDATE users SET totp_last_step = p_step WHERE username = p_username AND totp_enabled AND (totp_last_step IS NULL OR totp_last_step < p_step) RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u) $$;

CREATE OR REPLACE FUNCTION totp_use_recovery(p_username text, p_hash text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (UPDATE users SET totp_recovery = array_remove(totp_recovery, p_hash) WHERE username = p_username AND totp_enabled AND p_hash = ANY (totp_recovery) RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u) $$;

CREATE OR REPLACE FUNCTION totp_disable(p_username text, p_actor text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, totp_recovery = '{}', totp_enrolled_at = NULL WHERE username = p_username;
  IF FOUND THEN INSERT INTO audit_log(actor, table_name, op, row_pk, old_data, new_data) VALUES (p_actor, 'users', '2FA_DISABLED', p_username, NULL, NULL); END IF;
  RETURN FOUND;
END $$;

-- admin recovery for a user who lost the phone AND the recovery codes
CREATE OR REPLACE FUNCTION admin_reset_totp(p_id int, p_actor text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text;
BEGIN
  UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, totp_recovery = '{}', totp_enrolled_at = NULL WHERE id = p_id RETURNING username INTO v_name;
  IF v_name IS NULL THEN RETURN false; END IF;
  INSERT INTO audit_log(actor, table_name, op, row_pk, old_data, new_data) VALUES (p_actor, 'users', '2FA_RESET', v_name, NULL, NULL);
  RETURN true;
END $$;

-- which users have 2FA (no secrets): lets an admin see who is protected
CREATE OR REPLACE FUNCTION users_2fa_status() RETURNS TABLE(id int, username text, role text, totp_enabled boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT id, username, role, totp_enabled FROM users ORDER BY id $$;

REVOKE EXECUTE ON FUNCTION totp_state, totp_begin, totp_confirm, totp_advance, totp_use_recovery, totp_disable, admin_reset_totp, users_2fa_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION totp_state, totp_begin, totp_confirm, totp_advance, totp_use_recovery, totp_disable, admin_reset_totp, users_2fa_status TO erpx_app;

-- the generic audit trail must never copy 2FA material (secret, recovery hashes) into audit_log, exactly as it already drops pw_hash
CREATE OR REPLACE FUNCTION audit_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  o := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'pw_hash' - 'totp_secret_enc' - 'totp_recovery' - 'totp_last_step' END;
  n := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'pw_hash' - 'totp_secret_enc' - 'totp_recovery' - 'totp_last_step' END;
  INSERT INTO audit_log(actor,table_name,op,row_pk,old_data,new_data)
  VALUES (coalesce(current_setting('erpx.user',true),session_user), TG_TABLE_NAME, TG_OP, coalesce(n,o)->>'id', o, n);
  RETURN NULL;
END $$;

INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES ('schema', '{"version":"0.16.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = 'migration', updated_at = now();
