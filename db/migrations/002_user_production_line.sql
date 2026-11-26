BEGIN;

CREATE TABLE IF NOT EXISTS app_production_lines (
  line_code text PRIMARY KEY,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_production_lines (line_code, name)
SELECT DISTINCT
       lower(trim(line_code)),
       'Line ' || regexp_replace(trim(line_code), '^line', '', 'i')
  FROM machines
 WHERE nullif(trim(line_code), '') IS NOT NULL
ON CONFLICT (line_code) DO NOTHING;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS line_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'app_users_line_code_fkey'
       AND conrelid = 'app_users'::regclass
  ) THEN
    ALTER TABLE app_users
      ADD CONSTRAINT app_users_line_code_fkey
      FOREIGN KEY (line_code) REFERENCES app_production_lines(line_code)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS app_users_line_code_idx ON app_users (line_code);

COMMIT;
