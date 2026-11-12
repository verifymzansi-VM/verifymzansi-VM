-- No default rights for the API roles on new objects in schema public.
--
-- The foundation keeps no table, sequence or function in schema public: the
-- website reaches the database only through the api schema. Postgres still
-- keeps default privileges for the role postgres in public, which would be
-- copied onto anything postgres creates there later. A read-only catalogue
-- capture of production on 6 November 2026 recorded these defaults for
-- objects created by postgres in schema public (pg_default_acl):
--
--   tables     {postgres=arwdDxtm/postgres,anon=Dxtm/postgres,
--               authenticated=Dxtm/postgres,service_role=Dxtm/postgres}
--   sequences  {postgres=rwU/postgres,anon=w/postgres,
--               authenticated=w/postgres,service_role=w/postgres}
--   functions  {postgres=X/postgres}
--
-- that is TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on new tables and UPDATE
-- on new sequences for anon, authenticated and service_role. A fresh local
-- Supabase database (image public.ecr.aws/supabase/postgres:17.11.0.004 with
-- its own start-up scripts) starts with every privilege instead: arwdDxtm on
-- tables, rwU on sequences and X on functions for the same three roles.
--
-- This update withdraws all of them (and any for PUBLIC), whatever they were,
-- so that afterwards the three rows read:
--
--   tables     {postgres=arwdDxtm/postgres}
--   sequences  {postgres=rwU/postgres}
--   functions  {postgres=X/postgres}
--
-- service_role is included: the server-side code calls api commands only and
-- no foundation code, worker or Supabase service uses a table, sequence or
-- function in public. A reviewed update that ever adds an object to public
-- must grant what it needs explicitly.
--
-- Not changed, on purpose:
-- - Rights on schema public itself. anon, authenticated and service_role have
--   USAGE only (no CREATE), and PUBLIC has USAGE as well, so revoking it from
--   the three roles would not take it away; revoking it from PUBLIC would also
--   reach the Supabase service roles. USAGE gives nothing while public holds
--   no objects.
-- - Objects already in public: there are none of the foundation's.
-- - The defaults of supabase_admin in public (all privileges on new tables,
--   sequences and functions for anon, authenticated and service_role). Only
--   supabase_admin, or a member of it, may change them; on the hosted project
--   the SQL editor runs as postgres, which is not, so Postgres answers
--   "permission denied to change default privileges". No foundation step
--   creates objects as supabase_admin; extensions belong in schema extensions.
--
-- The update runs as postgres (the hosted SQL editor and the local Supabase
-- CLI stack) or as a superuser (the PGlite replay and the lint container). It
-- changes no function, table, grant on an existing object or API command, and
-- default privileges only affect objects created later, so it can be applied
-- before or after any website release and holds no lock on application
-- tables. The post-check refuses (55000) if postgres would still give the
-- three roles or PUBLIC anything on new tables, sequences or functions in
-- public. Running it again changes nothing.
--
-- Read-only preflight: ../preflight/20261111234521_public_default_privileges.check.sql
-- Reviewed rollback:   ../rollback/20261111234521_public_default_privileges.down.sql
begin;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role, public;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role, public;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role, public;

do $$
declare
  left_over text;
begin
  -- Per-schema default privileges add to the role's global ones
  -- (defaclnamespace 0), so both count.
  select string_agg(
      format('%s %s to %s',
        case d.defaclnamespace when 0 then 'all schemas' else 'public' end,
        case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
          else 'functions' end,
        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end),
      '; ' order by d.defaclnamespace, d.defaclobjtype, a.grantee)
    into left_over
  from pg_catalog.pg_default_acl d
  cross join lateral pg_catalog.aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace in (0, 'public'::regnamespace)
    and d.defaclobjtype in ('r', 'S', 'f')
    and (a.grantee = 0
      or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole));
  if left_over is not null then
    raise exception 'postgres still gives default privileges on new objects in public: %', left_over
      using errcode = '55000';
  end if;
  -- Without a global row, new functions are executable by PUBLIC (the
  -- built-in default). candidate.sql revokes that; refuse if it is missing.
  if not exists (
    select 1 from pg_catalog.pg_default_acl d
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
  ) then
    raise exception 'postgres still gives PUBLIC execute on new functions (built-in default)'
      using errcode = '55000';
  end if;
end$$;

commit;
