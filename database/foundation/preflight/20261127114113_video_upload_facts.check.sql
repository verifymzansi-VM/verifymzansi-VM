-- Read-only preflight for updates/20261127114113_video_upload_facts.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.media_object_transition_guard and the
-- video completion command have the reviewed bodies (update not applied) or
-- the update's (already applied), and counts the stored videos (ready) and,
-- once the column exists, the ones with upload facts.
do $$begin
  set transaction read only;
end$$;
with expected(sig, reviewed, updated) as (values
  ('internal.media_object_transition_guard()', 'c0354cb254c330c832d03ba5fdda2242', 'e3add64969ae482cc7a65f147ecbcf42'),
  ('internal.complete_frontend_video_upload(uuid,integer,text,text,integer)', '316d5afbd7c6c99b0f8f60ac1a739f6a', null),
  ('api.complete_frontend_video_upload(uuid,integer,text,text,integer)', 'b770d07810330de458f9d09728ed3b38', null),
  ('internal.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb)', null, '253bc5ca5f4c9f8d85484e9a8bdfb7b7'),
  ('api.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb)', null, 'd53810773255ee21eb7e1f09325eeec7')
),
bodies as (
  select e.*, (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
    where p.oid = to_regprocedure(e.sig)) as body
  from expected e
),
state as (
  select
    exists(select 1 from pg_attribute a where a.attrelid = 'private.media_objects'::regclass
      and a.attname = 'video_facts' and not a.attisdropped) as has_column,
    bool_and(body is not distinct from reviewed) as not_applied,
    bool_and(body is not distinct from updated) as applied
  from bodies
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies
  where body is not null and body is distinct from reviewed and body is distinct from updated
)
select 'summary' as kind,
  'video upload facts: '
    || case when s.not_applied and not s.has_column then 'update not applied'
         when s.applied and s.has_column then 'already applied'
         else 'unexpected state' end
    || '; videos stored: ' || (select count(*) from private.media_objects m
         where m.kind = 'video' and m.state = 'ready')
    || case when s.has_column then '; with facts: ' || (select count(*) from private.media_objects m
         where m.kind = 'video' and m.state = 'ready' and to_jsonb(m) -> 'video_facts' <> 'null'::jsonb)
       else '' end as detail
from state s
union all
select kind, detail from problems;
