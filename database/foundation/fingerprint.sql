-- Foundation schema fingerprint: one row per category with an item count and
-- an md5 of the sorted items. Read-only catalogue query (no table rows), so it
-- can run on the CI replay and, unchanged, in the Supabase SQL editor on
-- production. Equal rows mean equal structure.
--
-- The function_bodies, columns, constraints, indexes and triggers formats are
-- the ones used for the 6 November 2026 production capture recorded in
-- fingerprint.json; keep them byte-for-byte so values stay comparable.
with
app_rel as (
  select c.oid, c.relname, c.relkind, c.relacl, c.relrowsecurity, c.relforcerowsecurity, n.nspname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('api', 'internal', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
),
app_fn as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proconfig, p.proacl, p.prolang,
    n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api', 'internal')
),
api_role as (
  select unnest(array['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) as rolname
),
items as (
  select 'function_bodies' as category,
    sig || '=' || md5(replace(prosrc, chr(13) || chr(10), chr(10))) as s
  from app_fn
  union all
  select 'columns',
    r.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':'
      || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
  from app_rel r
  join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where r.relkind in ('r', 'p')
  union all
  select 'constraints', r.relname || ':' || c.conname || ':' || pg_get_constraintdef(c.oid)
  from pg_constraint c join app_rel r on r.oid = c.conrelid
  where c.contype in ('c', 'f', 'p', 'u', 'x')
  union all
  select 'indexes', pg_get_indexdef(i.indexrelid)
  from pg_index i join app_rel r on r.oid = i.indrelid
  union all
  -- Application triggers, including the ones placed on Auth tables.
  select 'triggers', pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal and pn.nspname in ('api', 'internal', 'private')
  union all
  select 'function_metadata',
    sig || ' definer=' || prosecdef || ' volatility=' || provolatile::text
      || ' language=' || (select lanname from pg_language l where l.oid = prolang)
      || ' returns=' || pg_get_function_result(oid)
      || ' config=' || coalesce(array_to_string(proconfig, ';'), '')
  from app_fn
  union all
  select 'function_grants',
    f.sig || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      || ':' || a.privilege_type
  from app_fn f cross join lateral aclexplode(f.proacl) a
  where a.grantee = 0 or pg_get_userbyid(a.grantee) in (select rolname from api_role)
  union all
  select 'policies',
    schemaname || '.' || tablename || ' ' || policyname || ' ' || permissive || ' ' || cmd
      || ' roles=' || array_to_string(roles, ',')
      || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '')
  from pg_policies
  where schemaname in ('api', 'internal', 'private')
  union all
  select 'table_grants',
    r.nspname || '.' || r.relname || ' '
      || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type
  from app_rel r cross join lateral aclexplode(r.relacl) a
  where a.grantee = 0 or pg_get_userbyid(a.grantee) in (select rolname from api_role)
  union all
  select 'column_grants',
    r.nspname || '.' || r.relname || '.' || att.attname || ' '
      || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type
  from app_rel r
  join pg_attribute att on att.attrelid = r.oid and att.attnum > 0 and not att.attisdropped
    and att.attacl is not null
  cross join lateral aclexplode(att.attacl) a
  where a.grantee = 0 or pg_get_userbyid(a.grantee) in (select rolname from api_role)
  union all
  select 'row_level_security',
    nspname || '.' || relname || ' rls=' || relrowsecurity || ' force=' || relforcerowsecurity
  from app_rel where relkind in ('r', 'p')
  union all
  select 'schema_grants',
    n.nspname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      || ':' || a.privilege_type
  from pg_namespace n cross join lateral aclexplode(n.nspacl) a
  where n.nspname in ('api', 'internal', 'private')
    and (a.grantee = 0 or pg_get_userbyid(a.grantee) in (select rolname from api_role))
  union all
  select 'event_triggers',
    e.evtname || ' ' || e.evtevent || ' ' || pn.nspname || '.' || p.proname
      || ' enabled=' || e.evtenabled::text || ' tags=' || coalesce(array_to_string(e.evttags, ','), '')
  from pg_event_trigger e
  join pg_proc p on p.oid = e.evtfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where pn.nspname in ('api', 'internal', 'private')
)
select category, count(*)::int as items,
  md5(string_agg(s, case when category = 'function_bodies' then ',' else chr(10) end
    order by s collate "C")) as fingerprint
from items
group by category
order by category;
