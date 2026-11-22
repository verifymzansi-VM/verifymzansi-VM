-- Read-only preflight for updates/20261121131915_business_storefront.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.search_posts is the reviewed body and the
-- four new functions are absent (update not applied), or everything is the
-- update's (already applied), and counts:
-- - "running packages": accounts whose Multi-listing package runs now;
-- - "checked businesses": businesses holding a current CIPC sticker;
-- - after the update, "storefronts": businesses that show a storefront.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.search_posts(jsonb)', '47d9d7f5dc22300611d0b07dd3a998f0', '590ffdf23439ddbf6772f70afd199740'),
    ('internal.storefront_package(uuid)', null, '7cd9edac97d66da49e4c543fffd0ce1f'),
    ('internal.storefront_of_post(uuid)', null, '7bc0a68b3f47f575b38a0bf548feb563'),
    ('internal.get_public_storefront(uuid)', null, 'ef68edd639d120c802470faa715a08ff'),
    ('api.get_public_storefront(uuid)', null, '7e0745f7345d8ae26f984305fc06f573')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is neither the reviewed body nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and reviewed <> total and updated <> total
)
select 'summary' as kind,
  'business storefront: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; running packages: ' || (select count(*) from (select distinct k.owner_id from private.slot_packages k) o
         where exists (select 1 from internal.slot_package_now(o.owner_id)))
    || '; checked businesses: ' || (select count(*) from private.frontend_current_cipc_stickers)
    -- The helper exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when s.updated = s.total
         then '; storefronts: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.posts b'
             || ' where b.kind = ''business'' and internal.storefront_package(b.id) is not null',
             false, true, '')))[1]::text
         else '' end as detail
from state s
union all
select kind, detail from problems;
