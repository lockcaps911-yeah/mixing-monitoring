BEGIN;

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN', 'USER')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX app_users_email_lower_unique ON app_users (lower(email));
CREATE INDEX app_users_role_active_idx ON app_users (role, is_active);

CREATE TABLE app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_sessions_user_id_idx ON app_sessions (user_id);
CREATE INDEX app_sessions_expires_at_idx ON app_sessions (expires_at);

CREATE TABLE app_audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_audit_logs_created_at_idx ON app_audit_logs (created_at DESC);
CREATE INDEX app_audit_logs_actor_idx ON app_audit_logs (actor_user_id, created_at DESC);

CREATE TABLE app_login_attempts (
  id bigserial PRIMARY KEY,
  email_hash text NOT NULL,
  ip_hash text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_login_attempts_email_time_idx ON app_login_attempts (email_hash, attempted_at DESC);
CREATE INDEX app_login_attempts_ip_time_idx ON app_login_attempts (ip_hash, attempted_at DESC);

COMMIT;
