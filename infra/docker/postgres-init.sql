-- infra/docker/postgres-init.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- 1. Migration role (owns tables, runs DDL only)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tc_migrator') THEN
    CREATE ROLE tc_migrator WITH LOGIN PASSWORD 'migrator_local_pw' CREATEDB;
  END IF;
END
$$;

-- 2. Runtime application role (strictly NOBYPASSRLS, cannot alter schema)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tc_app') THEN
    CREATE ROLE tc_app WITH LOGIN PASSWORD 'app_local_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE tradecloseout TO tc_migrator, tc_app;
GRANT CREATE, USAGE ON SCHEMA public TO tc_migrator;
GRANT USAGE ON SCHEMA public TO tc_app;

ALTER DEFAULT PRIVILEGES FOR ROLE tc_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tc_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tc_app;
