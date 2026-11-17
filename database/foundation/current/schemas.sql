-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create schema api authorization postgres;
revoke all on schema api from public;
grant usage on schema api to anon;
grant usage on schema api to authenticated;
grant usage on schema api to service_role;
create schema internal authorization postgres;
revoke all on schema internal from public;
grant usage on schema internal to anon;
grant usage on schema internal to authenticated;
grant usage on schema internal to service_role;
create schema private authorization postgres;
revoke all on schema private from public;
grant usage on schema private to supabase_auth_admin;
create extension pg_trgm with schema extensions version '1.6';
-- default privileges for role postgres on functions: execute to postgres
create event trigger require_table_rls on ddl_command_end when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE') execute function internal.require_table_rls();
