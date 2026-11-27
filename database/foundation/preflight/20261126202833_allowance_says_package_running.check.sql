-- Read-only preflight for updates/20261126202833_allowance_says_package_running.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.get_my_frontend_posting_allowance_v2 has
-- the reviewed body (update not applied) or the update's (already applied),
-- and counts the Multi-listing packages running now (accounts whose
-- allowance will say package_running true).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.get_my_frontend_posting_allowance_v2(text)', '18edc8cd354b8990c7b557fa4f00eea3', '76cb38d3421bb1910b1cd40a2d85082c')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
)
select 'summary' as kind,
  'package running in the allowance: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; packages running: ' || (select count(*) from (select distinct e.owner_id from private.entitlements e
         where e.package_id is not null) o where exists (select 1 from internal.slot_package_now(o.owner_id))) as detail
from state s
union all
select 'problem', sig || ' is neither the reviewed body nor the update''s (md5 '
    || coalesce(body, 'missing') || '); do not apply the update'
  from bodies where body is distinct from reviewed and body is distinct from updated;
