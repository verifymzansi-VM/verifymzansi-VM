-- Read-only preflight for updates/20261119172135_post_views_and_likes.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the six tables and eight functions of the update
-- are all absent (update not applied, with the number of publicly listed
-- posts), all present (already applied, with the likes, the days of views and
-- the views recorded) or partly present (unexpected state). A problem row
-- names each of the three replaced functions (privacy export, retention job,
-- account erasure) that does not have its reviewed body.
do $$begin
  set transaction read only;
end$$;
with objects as (
  select v.name, v.present
  from (values
    ('private.engagement_keys', to_regclass('private.engagement_keys') is not null),
    ('private.post_view_salts', to_regclass('private.post_view_salts') is not null),
    ('private.post_view_marks', to_regclass('private.post_view_marks') is not null),
    ('private.post_view_days', to_regclass('private.post_view_days') is not null),
    ('private.post_engagement_totals', to_regclass('private.post_engagement_totals') is not null),
    ('private.post_likes', to_regclass('private.post_likes') is not null),
    ('internal.record_post_views(uuid[],uuid,uuid)',
      to_regprocedure('internal.record_post_views(uuid[],uuid,uuid)') is not null),
    ('api.record_post_views(uuid[],uuid,uuid)',
      to_regprocedure('api.record_post_views(uuid[],uuid,uuid)') is not null),
    ('internal.set_post_like(uuid,uuid,uuid,boolean,timestamptz)',
      to_regprocedure('internal.set_post_like(uuid,uuid,uuid,boolean,timestamptz)') is not null),
    ('api.set_post_like(uuid,uuid,uuid,boolean,timestamptz)',
      to_regprocedure('api.set_post_like(uuid,uuid,uuid,boolean,timestamptz)') is not null),
    ('internal.get_post_engagement(uuid[])',
      to_regprocedure('internal.get_post_engagement(uuid[])') is not null),
    ('api.get_post_engagement(uuid[])', to_regprocedure('api.get_post_engagement(uuid[])') is not null),
    ('internal.purge_post_engagement()', to_regprocedure('internal.purge_post_engagement()') is not null),
    ('internal.post_likes_count()', to_regprocedure('internal.post_likes_count()') is not null)
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
    ('internal.frontend_privacy_export_data(uuid)', 'e3842fd91a8d4f6b0bfe4cdc5b3030d9', '3dfe35ae5e93f0661ecd7dbf710cf45d'),
    ('internal.run_retention(integer)', '3fc3981961fda5c149c6540e03a5b4c3', '06a3fbfcb5b2d53e2487719174a62cc5'),
    ('internal.erase_closed_account(uuid,text)', '0110024c386259da47b96caf79555bac', 'c1352cec14d02d401b58e466c387d747')
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
  -- Read by name at run time: the tables do not exist before the update.
  select (xpath('/row/n/text()', query_to_xml(q, false, true, '')))[1]::text as n, label
  from state s, (values
    ('likes', 'select count(*) as n from private.post_likes'),
    ('view days', 'select count(*) as n from private.post_view_days'),
    ('views', 'select coalesce(sum(views),0) as n from private.post_view_days')
  ) v(label, q)
  where s.applied
)
select 'summary' as kind,
  'post views and likes: '
    || case when s.applied then 'already applied; '
           || (select string_agg(label || ': ' || n, '; ' order by label) from counts)
         when s.absent then 'update not applied; publicly listed posts: '
           || (select count(*) from private.post_search_documents d where d.is_visible
                 and (d.visible_until is null or d.visible_until > statement_timestamp()))
         else 'unexpected state' end as detail
from state s
union all
select kind, detail from problems;
