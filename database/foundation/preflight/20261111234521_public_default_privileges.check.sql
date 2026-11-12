-- Read-only preflight for updates/20261111234521_public_default_privileges.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only and the second is a catalogue query, so when the
-- file runs as one transaction (as the SQL editor runs it) Postgres refuses
-- any write.
--
-- The result has one "summary" row, then one "unchanged" row per default
-- privilege the update cannot withdraw (those of supabase_admin in public),
-- then one "problem" row per reason to stop. Apply the update only when the
-- summary reads "not applied; matches the production capture" and there is no
-- problem row: the reviewed rollback restores exactly that capture, so for any
-- other starting state it would not be an exact undo. Afterwards the summary
-- must read "already applied".
do $$begin
  set transaction read only;
end$$;
with api_role(rolname) as (values ('anon'), ('authenticated'), ('service_role')),
kinds(objtype, word) as (values ('r', 'tables'), ('S', 'sequences'), ('f', 'functions')),
-- Default privileges of postgres in public for the three roles and PUBLIC,
-- one item per object kind, grantee and privilege.
current_items as (
  select k.word || ' '
      || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end
      || ':' || a.privilege_type || case when a.is_grantable then ' with grant option' else '' end
      as item
  from pg_catalog.pg_default_acl d
  join kinds k on k.objtype = d.defaclobjtype::text
  cross join lateral pg_catalog.aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace = 'public'::regnamespace
    and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in (select rolname from api_role))
),
-- The production capture of 6 November 2026, which the rollback restores.
captured_items as (
  select k.word || ' ' || r.rolname || ':' || p.privilege as item
  from api_role r
  cross join (values
    ('tables', 'MAINTAIN'), ('tables', 'REFERENCES'), ('tables', 'TRIGGER'), ('tables', 'TRUNCATE'),
    ('sequences', 'UPDATE')
  ) p(word, privilege)
  join kinds k on k.word = p.word
),
differences as (
  select 'extra ' || item as item from (select item from current_items except select item from captured_items) e
  union all
  select 'missing ' || item from (select item from captured_items except select item from current_items) m
),
unchanged as (
  select 'unchanged' as kind,
    format('supabase_admin gives %s on new %s in public (only supabase_admin may change this)',
      string_agg(a.privilege_type, ', ' order by a.privilege_type) || ' to '
        || pg_catalog.pg_get_userbyid(a.grantee),
      k.word) as detail
  from pg_catalog.pg_default_acl d
  join kinds k on k.objtype = d.defaclobjtype::text
  cross join lateral pg_catalog.aclexplode(d.defaclacl) a
  where d.defaclrole = 'supabase_admin'::regrole
    and d.defaclnamespace = 'public'::regnamespace
    and pg_catalog.pg_get_userbyid(a.grantee) in (select rolname from api_role)
  group by k.word, a.grantee
),
problems as (
  -- The update cannot withdraw global default privileges (all schemas), which
  -- also reach public; it refuses when they give the three roles or PUBLIC
  -- anything.
  select 'problem' as kind,
    format('postgres gives %s on new %s in all schemas to %s; the update would refuse',
      a.privilege_type, k.word,
      case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end) as detail
  from pg_catalog.pg_default_acl d
  join kinds k on k.objtype = d.defaclobjtype::text
  cross join lateral pg_catalog.aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0
    and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in (select rolname from api_role))
  union all
  select 'problem', 'postgres gives PUBLIC execute on new functions (no global default row); the update would refuse'
  where not exists (select 1 from pg_catalog.pg_default_acl d
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f')
  union all
  select 'problem', 'not applied, and the starting state differs from the production capture: '
      || string_agg(item, '; ' order by item collate "C")
  from differences
  having count(*) > 0 and (select count(*) from current_items) > 0
),
summary as (
  select 'summary' as kind,
    'public default privileges: '
      || case
           when (select count(*) from current_items) = 0
             then 'already applied; postgres gives anon, authenticated, service_role and PUBLIC nothing on new tables, sequences or functions in public'
           when not exists (select 1 from differences)
             then 'not applied; matches the production capture of 6 November 2026 (can be applied before or after any website release)'
           else 'not applied; differs from the production capture of 6 November 2026 (see the problem row)'
         end
      || '; objects in public outside extensions: '
      || (select count(*) from pg_catalog.pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
            and not exists (select 1 from pg_catalog.pg_depend e
              where e.classid = 'pg_catalog.pg_class'::regclass and e.objid = c.oid and e.deptype = 'e'))
      || ' relations, '
      || (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and not exists (select 1 from pg_catalog.pg_depend e
              where e.classid = 'pg_catalog.pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e'))
      || ' functions' as detail
)
select kind, detail from (
  select 1 as rank, kind, detail from summary
  union all
  select 2, kind, detail from unchanged
  union all
  select 3, kind, detail from problems
) rows
order by rank, detail collate "C";
