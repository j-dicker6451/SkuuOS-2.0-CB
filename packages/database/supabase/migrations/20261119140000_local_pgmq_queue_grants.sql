-- SkuuOS / local dev: pg_cron sweeper and the jobs queue drainer read PGMQ tables.
-- SPDX-License-Identifier: AGPL-3.0-only

GRANT USAGE ON SCHEMA pgmq TO postgres, supabase_admin;

GRANT SELECT ON ALL TABLES IN SCHEMA pgmq TO postgres, supabase_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq
  GRANT SELECT ON TABLES TO postgres, supabase_admin;