-- Read-only preflight for updates/20261126001956_video_length_checked.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.media_object_transition_guard has the
-- reviewed body (update not applied) or the update's (already applied), and
-- counts the stored videos (ready and not deleted), the posts waiting for
-- review with a video and, of those, event posts.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
    where p.oid = to_regprocedure('internal.media_object_transition_guard()')) as body
),
problems as (
  select 'problem' as kind, 'internal.media_object_transition_guard() is neither the reviewed body nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies
    where body is distinct from '98c0d44cf27009757ed8db343d308f0a'
      and body is distinct from 'c0354cb254c330c832d03ba5fdda2242'
)
select 'summary' as kind,
  'video length check: '
    || case b.body when 'c0354cb254c330c832d03ba5fdda2242' then 'already applied'
         when '98c0d44cf27009757ed8db343d308f0a' then 'update not applied'
         else 'unexpected state' end
    || '; videos stored: ' || (select count(*) from private.media_objects m
         where m.kind = 'video' and m.state = 'ready')
    || '; posts waiting with a video: ' || (select count(distinct p.id) from private.posts p
         join private.post_media pm on pm.post_id = p.id
         join private.media_objects m on m.id = pm.object_id and m.kind = 'video'
         where p.status = 'pending_moderation')
    || ' (events: ' || (select count(distinct p.id) from private.posts p
         join private.post_media pm on pm.post_id = p.id
         join private.media_objects m on m.id = pm.object_id and m.kind = 'video'
         where p.status = 'pending_moderation' and p.kind = 'event')
    || ')' as detail
from bodies b
union all
select kind, detail from problems;
