-- Rollback for updates/20261111234521_public_default_privileges.sql.
--
-- Restores exactly the default privileges that production's postgres role had
-- in schema public in the read-only catalogue capture of 6 November 2026,
-- which the preflight confirms before the update is applied:
--
--   tables     {postgres=arwdDxtm/postgres,anon=Dxtm/postgres,
--               authenticated=Dxtm/postgres,service_role=Dxtm/postgres}
--   sequences  {postgres=rwU/postgres,anon=w/postgres,
--               authenticated=w/postgres,service_role=w/postgres}
--   functions  {postgres=X/postgres}
--
-- (TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on new tables and UPDATE on new
-- sequences for anon, authenticated and service_role). It refuses (55000)
-- unless postgres's defaults in public for these roles and PUBLIC are either
-- none (the update applied) or exactly that capture (no grant options),
-- because otherwise it would not be the update's undo. Running it again, or
-- before the update, changes nothing.
-- It affects only objects created later; no function, grant on an existing
-- object or API command changes.
begin;

do $$
declare
  current_items text;
begin
  select string_agg(item, '; ' order by item collate "C")
    into current_items
  from (
    select case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
             when 'f' then 'functions' else d.defaclobjtype::text end
           || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end
           || ':' || a.privilege_type || case when a.is_grantable then ' with grant option' else '' end
           as item
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and d.defaclnamespace = 'public'::regnamespace
      and (a.grantee = 0
        or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))
  ) items;
  if current_items is not null and current_items <> concat_ws('; ',
      'sequences anon:UPDATE', 'sequences authenticated:UPDATE', 'sequences service_role:UPDATE',
      'tables anon:MAINTAIN', 'tables anon:REFERENCES', 'tables anon:TRIGGER', 'tables anon:TRUNCATE',
      'tables authenticated:MAINTAIN', 'tables authenticated:REFERENCES',
      'tables authenticated:TRIGGER', 'tables authenticated:TRUNCATE',
      'tables service_role:MAINTAIN', 'tables service_role:REFERENCES',
      'tables service_role:TRIGGER', 'tables service_role:TRUNCATE') then
    raise exception 'default privileges of postgres in public are neither the update''s nor the production capture: %',
      current_items using errcode = '55000';
  end if;
end$$;

alter default privileges for role postgres in schema public
  grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant update on sequences to anon, authenticated, service_role;

commit;
