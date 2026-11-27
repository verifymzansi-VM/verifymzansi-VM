-- Reviewed rollback for updates/20261127114113_video_upload_facts.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. It puts back the 5-argument
-- api.complete_frontend_video_upload and its internal function, and the
-- earlier body of internal.media_object_transition_guard, byte for byte, and
-- drops the private.media_objects.video_facts column (the stored upload facts
-- are lost; they are measurements, not decisions). Undo the website first: it
-- sends p_facts, which the 5-argument command does not accept.
-- It refuses (55000) unless the guard has the update's body.
begin;
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.media_object_transition_guard()');
  if body is null or body not in('e3add64969ae482cc7a65f147ecbcf42') then
    raise exception 'rollback precondition: the video upload facts update is not applied as reviewed (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

drop function if exists api.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb);
drop function if exists internal.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb);

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

alter table private.media_objects drop column if exists video_facts;

notify pgrst,'reload schema';
commit;
