-- Read-only preflight for updates/20261121100028_post_performance_stats.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the table, the column and the five functions of
-- the update are all absent (update not applied, with the number of publicly
-- listed posts), all present (already applied, with the activity days and
-- engaged views recorded) or partly present (unexpected state). A problem row
-- names each of the three replaced functions (retention job, engagement
-- clean-up, scheduled job catalogue) that does not have its reviewed body.
do $$begin
  set transaction read only;
end$$;
with objects as (
  select v.name, v.present
  from (values
    ('private.post_activity_days', to_regclass('private.post_activity_days') is not null),
    ('private.post_engagement_totals.engaged_views', exists(select 1 from pg_attribute a
      where a.attrelid = to_regclass('private.post_engagement_totals') and a.attname = 'engaged_views'
        and not a.attisdropped)),
    ('internal.record_post_activity(uuid[],text[],uuid,uuid)',
      to_regprocedure('internal.record_post_activity(uuid[],text[],uuid,uuid)') is not null),
    ('api.record_post_activity(uuid[],text[],uuid,uuid)',
      to_regprocedure('api.record_post_activity(uuid[],text[],uuid,uuid)') is not null),
    ('internal.get_my_post_performance()', to_regprocedure('internal.get_my_post_performance()') is not null),
    ('api.get_my_post_performance()', to_regprocedure('api.get_my_post_performance()') is not null),
    ('api.purge_post_engagement()', to_regprocedure('api.purge_post_engagement()') is not null)
  ) v(name, present)
),
state as (
  select bool_and(not present) as absent, bool_and(present) as applied from objects
),
bodies as (
  select v.sig, v.before_md5, v.after_md5,
    coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
      where p.oid=to_regprocedure(v.sig)),'absent') as md5
  from (values
    ('internal.run_retention(integer)', '1d51acbc8fb435ac6f9b1f12a9020c2b', '135e5c77e403b724fdcd48844a994938'),
    ('internal.purge_post_engagement()', 'fbb695dd3bc67f5ae8a5d759f5fed652', 'bf66fca749e26139b57022aaaeb3d7bd'),
    ('internal.scheduled_job_catalogue()', '249bf575fc434934aafe0f0a68ea30dc', '64487ac2aa106de196e413992e126488')
  ) v(sig, before_md5, after_md5)
),
problems as (
  select 'problem' as kind,
    name || ' is ' || case when present then 'present' else 'missing' end
      || ' while other parts of the update are not; do not apply the update' as detail
  from objects, state
  where not state.absent and not state.applied
  union all
  select 'problem', b.sig || ' is not the reviewed body (' || b.md5 || '); do not apply the update'
  from bodies b, state s
  where b.md5 <> case when s.applied then b.after_md5 else b.before_md5 end
),
counts as (
  -- Read by name at run time: the table and column do not exist before the update.
  select (xpath('/row/n/text()', query_to_xml(q, false, true, '')))[1]::text as n, label
  from state s, (values
    ('activity days', 'select count(*) as n from private.post_activity_days'),
    ('engaged views', 'select coalesce(sum(engaged_views),0) as n from private.post_engagement_totals')
  ) v(label, q)
  where s.applied
)
select 'summary' as kind,
  'post performance stats: '
    || case when s.applied then 'already applied; '
           || (select string_agg(label || ': ' || n, '; ' order by label) from counts)
         when s.absent then 'update not applied; publicly listed posts: '
           || (select count(*) from private.post_search_documents d where d.is_visible
                 and (d.visible_until is null or d.visible_until > statement_timestamp()))
         else 'unexpected state' end as detail
from state s
union all
select kind, detail from problems;
