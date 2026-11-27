-- Upload facts for every stored video (video plan, phase 1a; launch checklist
-- item 86). The upload server reads each MP4's headers and checks them
-- against the keep rule (src/lib/media/video-rule.ts): H.264 Baseline, Main or
-- High up to level 4.2, up to 1080p, 30 fps (60 up to 720p), AAC or no audio,
-- no other tracks, the movie header first, up to 4 Mbps. What it found is now
-- stored with the video, so the next video steps are decided from real
-- uploads rather than from logs that are kept for seven days.
--
-- From this update:
-- - private.media_objects.video_facts (jsonb, null for pictures and for videos
--   stored before this update) holds codec, profile, level, width, height,
--   fps, faststart, audio, problem (the rule the file broke, or null) and,
--   later, source (kept, remuxed or converted, as the posting form reports
--   it). Length and size are already stored on the row (duration_ms,
--   size_bytes), so bitrate is not. Once set the facts never change
--   (internal.media_object_transition_guard, full body).
-- - api.complete_frontend_video_upload (service_role only) gains the optional
--   argument p_facts and stores it with the length. Unknown keys, wrong types
--   or more than 512 bytes are refused (22023, video_facts_invalid). A replay
--   with different facts keeps the first ones (they come from the bytes, but
--   a reader fix between two deploys must not turn a retry into an error);
--   a replay may add facts to a video completed without them.
--
-- Expand only: the command keeps its name and every caller's call; the new
-- argument is optional, so the 5-argument versions are replaced by versions
-- with the argument (the identity check consent pattern). One new column, two
-- replaced functions and one replaced trigger body; no new command.
-- ORDER: apply first, then merge. The live website calls the command with five
-- named arguments, which the new version answers exactly as before (no facts
-- stored). The new website sends p_facts, which only the new version accepts.
-- Apply only when this update's pull request is the next merge.
-- It refuses with 55000 unless every function it replaces has its reviewed
-- body, or the update is already fully in place.
-- Read-only preflight: ../preflight/20261127114113_video_upload_facts.check.sql.
-- Rollback: ../rollback/20261127114113_video_upload_facts.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare present integer; body record;
begin
  select (to_regprocedure('internal.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb)') is not null)::integer
    + (to_regprocedure('api.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb)') is not null)::integer
    + (to_regprocedure('internal.complete_frontend_video_upload(uuid,integer,text,text,integer)') is null)::integer
    + (to_regprocedure('api.complete_frontend_video_upload(uuid,integer,text,text,integer)') is null)::integer
    + (exists(select 1 from pg_attribute where attrelid='private.media_objects'::regclass
        and attname='video_facts' and not attisdropped))::integer
  into present;
  if present not in (0, 5) then
    raise exception 'video upload facts precondition: % of 5 pieces are in place', present using errcode='55000';
  end if;
  for body in select * from (values
      ('internal.media_object_transition_guard()', 'c0354cb254c330c832d03ba5fdda2242', 'e3add64969ae482cc7a65f147ecbcf42'),
      ('internal.complete_frontend_video_upload(uuid,integer,text,text,integer)', '316d5afbd7c6c99b0f8f60ac1a739f6a', null),
      ('api.complete_frontend_video_upload(uuid,integer,text,text,integer)', 'b770d07810330de458f9d09728ed3b38', null)
    ) v(sig, reviewed, applied) loop
    if present = 0 and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
        where oid=to_regprocedure(body.sig)) is distinct from body.reviewed then
      raise exception 'video upload facts precondition: % is not the reviewed body', body.sig using errcode='55000';
    end if;
    if present = 5 and body.applied is not null and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
        where oid=to_regprocedure(body.sig)) is distinct from body.applied then
      raise exception 'video upload facts precondition: % is not this update''s body', body.sig using errcode='55000';
    end if;
  end loop;
end$$;

alter table private.media_objects add column if not exists video_facts jsonb
  constraint media_objects_video_facts_check
  check (video_facts is null or (kind='video' and jsonb_typeof(video_facts)='object'
    and pg_column_size(video_facts)<=512));

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
  -- So are its upload facts.
  if old.video_facts is not null and new.video_facts is distinct from old.video_facts then
    raise exception 'video facts are immutable' using errcode = '23514';
  end if;
  new.state_changed_at := case when new.state <> old.state then statement_timestamp() else old.state_changed_at end;
  return new;
end;
$$;
revoke all on function internal.media_object_transition_guard() from public, anon, authenticated, service_role;

-- The command keeps its name; the argument is new and optional, so the
-- 5-argument versions go first (a call without the argument then reaches the
-- new version).
drop function if exists api.complete_frontend_video_upload(uuid,integer,text,text,integer);
drop function if exists internal.complete_frontend_video_upload(uuid,integer,text,text,integer);

-- Server: complete a content-bound video upload and store its length and
-- facts, read from the file by the upload server. Whole seconds decide the
-- length: up to 120 999 ms.
create or replace function internal.complete_frontend_video_upload(p_object_id uuid,p_size integer,p_sha256 text,
  p_mime text,p_duration_ms integer,p_facts jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare object private.media_objects;result jsonb;
begin
  if p_duration_ms is null or p_duration_ms not between 1 and 120999 then
    raise exception 'video length outside the limit' using errcode='22023',detail='video_length_invalid';end if;
  if p_facts is not null and (jsonb_typeof(p_facts)<>'object' or pg_column_size(p_facts)>512
      or exists(select 1 from jsonb_each(p_facts) f where not (
        (f.key in ('codec','audio') and jsonb_typeof(f.value)='string' and length(f.value#>>'{}') between 1 and 8)
        or (f.key in ('profile','level','width','height') and case when jsonb_typeof(f.value)='number'
          then f.value::numeric between 0 and 20000 and f.value::numeric%1=0 else false end)
        or (f.key='fps' and case when jsonb_typeof(f.value)='number'
          then f.value::numeric between 0 and 1000 else false end)
        or (f.key='faststart' and jsonb_typeof(f.value)='boolean')
        or (f.key='problem' and (jsonb_typeof(f.value)='null'
          or (jsonb_typeof(f.value)='string' and length(f.value#>>'{}') between 1 and 20)))
        or (f.key='source' and jsonb_typeof(f.value)='string' and f.value#>>'{}' in ('kept','remuxed','converted'))))) then
    raise exception 'video facts invalid' using errcode='22023',detail='video_facts_invalid';end if;
  select m.* into object from private.media_objects m where m.id=p_object_id for update;
  if not found or object.kind<>'video' then
    raise exception 'video upload required' using errcode='22023';end if;
  if object.duration_ms is not null and object.duration_ms<>p_duration_ms then
    raise exception 'upload completion changed' using errcode='PT409';end if;
  -- Owner, receipt, digest and replay checks are the media completion's own.
  result:=internal.complete_frontend_media_upload(p_object_id,p_size,p_sha256,p_mime,null,null);
  if result->>'state'='ready' then
    -- The first facts stay: a replay may add them, never change them.
    update private.media_objects set duration_ms=coalesce(duration_ms,p_duration_ms),
        video_facts=coalesce(video_facts,p_facts)
      where id=object.id and (duration_ms is null or (video_facts is null and p_facts is not null));
  end if;
  return result;
end$$;
revoke all on function internal.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) to service_role;
create or replace function api.complete_frontend_video_upload(p_object_id uuid,p_size integer,p_sha256 text,
  p_mime text,p_duration_ms integer,p_facts jsonb default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.complete_frontend_video_upload(p_object_id,p_size,p_sha256,p_mime,p_duration_ms,p_facts)
$$;
revoke all on function api.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function api.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
