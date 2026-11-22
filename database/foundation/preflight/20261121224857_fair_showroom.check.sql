-- Read-only preflight for updates/20261121224857_fair_showroom.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the two new functions are absent (update not
-- applied) or both have the update's bodies (already applied), and counts
-- "showroom posts": the publicly live posts the home showroom takes turns
-- between.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.showroom_feed(jsonb)', 'f4c4e91aa56bd9f3bb985c01d0c3d280'),
    ('api.showroom_feed(jsonb)', '20563a7dac3f7a15e63b08d6f00460da')
  ) v(sig, updated)
),
state as (
  select count(*) filter (where body is null) as absent,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' exists but is not the update''s body (md5 ' || body
      || '); do not apply the update' as detail
    from bodies where body is not null and body <> updated
  union all
  select 'problem', 'only part of the update is present'
    from state
    where not exists (select 1 from bodies where body is not null and body <> updated)
      and absent <> total and updated <> total
  union all
  select 'problem', 'private.post_activity_days is missing; apply 20261121100028_post_performance_stats.sql first'
    where to_regclass('private.post_activity_days') is null
)
select 'summary' as kind,
  'fair showroom: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied'
         else 'unexpected state' end
    || '; showroom posts: ' || (select count(*) from private.post_search_documents d
         where d.is_visible and d.published_at <= statement_timestamp()
           and (d.visible_until is null or d.visible_until > statement_timestamp())
           and exists (select 1 from private.public_eligible_posts e where e.id = d.post_id)) as detail
from state s
union all
select kind, detail from problems;
