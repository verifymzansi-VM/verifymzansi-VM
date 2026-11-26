-- The database checks video length (launch checklist item 39, roadmap M4.4
-- part B). Every video on the platform is at most 2 minutes, an event post's
-- video at most 1 minute; whole seconds decide, so 120.9 s passes and 121 s
-- does not. Until now the phone and the upload server checked only the
-- 2-minute cap and nothing was stored, so an event could be submitted with a
-- 61-120 s video (or with a listing's video reused through the media reuse
-- window) and staff could not see a video's length.
--
-- From this update:
-- - private.media_objects.duration_ms holds a video's length in whole
--   milliseconds, as the upload server read it from the file (null for
--   images, and for videos stored before this update). Once set it never
--   changes (internal.media_object_transition_guard, full body).
-- - api.complete_frontend_video_upload (service_role only, new) completes a
--   content-bound video upload exactly like api.complete_frontend_media_upload
--   and stores the length; a length of 121 s or more, an unknown length or a
--   picture is refused. Called again for a video that is already ready it is
--   an idempotent replay, and it fills in the length once for a video stored
--   earlier without one.
-- - internal.guard_video_length_submission, a trigger on private.posts like
--   the posting terms guard, refuses every move into pending_moderation
--   (submit, resubmit, reactivation, an edit's submission) while the post has
--   a video longer than its kind allows (60 s for events, 120 s otherwise:
--   22023 video_too_long, hint "<whole seconds>/<limit>") or a video without a
--   stored length (22023 video_length_unknown: the owner uploads it again). A
--   video already on the live post an edit copies keeps passing, so a live
--   post keeps its current video until it ends. Approval and the rest of the
--   lifecycle are unchanged.
-- - api.get_frontend_staff_video_lengths (authenticated staff with
--   queue:view, new) returns the stored length of each video of up to 50
--   posts waiting for review whose review claim the caller holds, the same
--   rule as the queue's review data.
-- Storage already grows with paid slots (internal.media_storage_allowance);
-- this update does not change it.
--
-- Expand only: one new column, two new commands, one new trigger and one
-- replaced trigger body; no command, argument or result changes.
-- ORDER: apply first, then merge. The live website calls neither new command
-- and parses no field this adds. Until the new website is deployed, a video it
-- uploads has no stored length, so a post with that video is refused at submit
-- and the owner uploads the video again.
-- It refuses with 55000 unless the guard has its reviewed body (or this
-- update's).
-- Read-only preflight: ../preflight/20261126001956_video_length_checked.check.sql.
-- Rollback: ../rollback/20261126001956_video_length_checked.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.media_object_transition_guard()');
  if body is null or body not in('98c0d44cf27009757ed8db343d308f0a','c0354cb254c330c832d03ba5fdda2242') then
    raise exception 'video length check precondition: internal.media_object_transition_guard() is not the reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

alter table private.media_objects add column if not exists duration_ms integer
  constraint media_objects_duration_ms_check
  check (duration_ms is null or (kind='video' and duration_ms between 1 and 120999));

create or replace function internal.media_object_transition_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (new.id, new.owner_id, new.kind, new.object_key, new.declared_bytes) is distinct from
     (old.id, old.owner_id, old.kind, old.object_key, old.declared_bytes) then
    raise exception 'media identity is immutable' using errcode = '23514';
  end if;
  if new.state <> old.state and not (
      (old.state = 'intent' and new.state in ('ready', 'rejected', 'cleanup_required'))
      or (old.state in ('ready', 'rejected') and new.state = 'cleanup_required')
      or (old.state = 'cleanup_required' and new.state = 'deleted')) then
    raise exception 'invalid media transition % -> %', old.state, new.state using errcode = '23514';
  end if;
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then
    raise exception 'media digest is immutable' using errcode = '23514';
  end if;
  -- A video's stored length is set once (at or after completion) and kept.
  if old.duration_ms is not null and new.duration_ms is distinct from old.duration_ms then
    raise exception 'video length is immutable' using errcode = '23514';
  end if;
  new.state_changed_at := case when new.state <> old.state then statement_timestamp() else old.state_changed_at end;
  return new;
end;
$$;
revoke all on function internal.media_object_transition_guard() from public, anon, authenticated, service_role;

-- Server: complete a content-bound video upload and store its length, read
-- from the file by the upload server. Whole seconds decide: up to 120 999 ms.
create or replace function internal.complete_frontend_video_upload(p_object_id uuid,p_size integer,p_sha256 text,
  p_mime text,p_duration_ms integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare object private.media_objects;result jsonb;
begin
  if p_duration_ms is null or p_duration_ms not between 1 and 120999 then
    raise exception 'video length outside the limit' using errcode='22023',detail='video_length_invalid';end if;
  select m.* into object from private.media_objects m where m.id=p_object_id for update;
  if not found or object.kind<>'video' then
    raise exception 'video upload required' using errcode='22023';end if;
  if object.duration_ms is not null and object.duration_ms<>p_duration_ms then
    raise exception 'upload completion changed' using errcode='PT409';end if;
  -- Owner, receipt, digest and replay checks are the media completion's own.
  result:=internal.complete_frontend_media_upload(p_object_id,p_size,p_sha256,p_mime,null,null);
  if result->>'state'='ready' then
    update private.media_objects set duration_ms=p_duration_ms where id=object.id and duration_ms is null;
  end if;
  return result;
end$$;
revoke all on function internal.complete_frontend_video_upload(uuid,integer,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function internal.complete_frontend_video_upload(uuid,integer,text,text,integer) to service_role;
create or replace function api.complete_frontend_video_upload(p_object_id uuid,p_size integer,p_sha256 text,
  p_mime text,p_duration_ms integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.complete_frontend_video_upload(p_object_id,p_size,p_sha256,p_mime,p_duration_ms)
$$;
revoke all on function api.complete_frontend_video_upload(uuid,integer,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function api.complete_frontend_video_upload(uuid,integer,text,text,integer) to service_role;

-- Every move into the review queue: each video must have a stored length
-- within the post kind's limit (events 60 s, everything else 120 s, whole
-- seconds). A video already on the live post an edit copies keeps passing.
create or replace function internal.guard_video_length_submission()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare limit_seconds integer;bad record;
begin
  if new.status<>'pending_moderation' then return new;end if;
  if tg_op='UPDATE' then
    if old.status='pending_moderation' then return new;end if;
  end if;
  limit_seconds:=case when new.kind='event' then 60 else 120 end;
  select m.duration_ms into bad from private.post_media pm join private.media_objects m on m.id=pm.object_id
    where pm.post_id=new.id and m.kind='video'
      and (m.duration_ms is null or m.duration_ms>=(limit_seconds+1)*1000)
      and not (new.edit_of is not null and exists(select 1 from private.post_media o
        where o.post_id=new.edit_of and o.object_id=pm.object_id))
    order by m.duration_ms desc nulls first limit 1;
  if not found then return new;end if;
  if bad.duration_ms is null then
    raise exception 'upload the video again so its length can be checked' using errcode='22023',detail='video_length_unknown';
  end if;
  raise exception 'the video is longer than this post allows' using errcode='22023',detail='video_too_long',
    hint=format('%s/%s',bad.duration_ms/1000,limit_seconds);
end$$;
revoke all on function internal.guard_video_length_submission() from public,anon,authenticated,service_role;
drop trigger if exists video_length_submission_guard on private.posts;
create trigger video_length_submission_guard before insert or update of status on private.posts
  for each row execute function internal.guard_video_length_submission();

-- Staff: the stored length of each video of posts waiting for review whose
-- review claim the caller holds (the queue shows review data only then).
create or replace function internal.get_frontend_staff_video_lengths(p_posts uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view');result jsonb;
begin
  if p_posts is null or cardinality(p_posts) not between 1 and 50 or array_ndims(p_posts)<>1
    or array_position(p_posts,null) is not null then
    raise exception 'bounded post list required' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('post_id',p.id,'object_key',m.object_key,'duration_ms',m.duration_ms)
      order by p.id,pm.purpose,pm.position),'[]'::jsonb) into result
    from private.posts p
    join private.queue_claims q on q.post_id=p.id and q.claimed_by=actor and q.claim_expires_at>clock_timestamp()
    join private.post_media pm on pm.post_id=p.id
    join private.media_objects m on m.id=pm.object_id and m.kind='video'
    where p.id=any(p_posts) and p.status='pending_moderation';
  return result;
end$$;
revoke all on function internal.get_frontend_staff_video_lengths(uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_staff_video_lengths(uuid[]) to authenticated;
create or replace function api.get_frontend_staff_video_lengths(p_posts uuid[])
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_frontend_staff_video_lengths(p_posts)
$$;
revoke all on function api.get_frontend_staff_video_lengths(uuid[]) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_staff_video_lengths(uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
