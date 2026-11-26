-- Reviewed rollback for updates/20261126001956_video_length_checked.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. It drops the submission guard
-- trigger and its function, the two commands the update added and the
-- private.media_objects.duration_ms column (the stored video lengths are
-- lost), and puts back the earlier body of internal.media_object_transition_guard
-- byte for byte. Undo the website first: it calls
-- api.complete_frontend_video_upload and api.get_frontend_staff_video_lengths.
-- It refuses (55000) unless the guard has the update's body.
begin;
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.media_object_transition_guard()');
  if body is null or body not in('c0354cb254c330c832d03ba5fdda2242') then
    raise exception 'rollback precondition: the video length update is not applied as reviewed (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

drop trigger if exists video_length_submission_guard on private.posts;
drop function if exists internal.guard_video_length_submission();
drop function if exists api.get_frontend_staff_video_lengths(uuid[]);
drop function if exists internal.get_frontend_staff_video_lengths(uuid[]);
drop function if exists api.complete_frontend_video_upload(uuid,integer,text,text,integer);
drop function if exists internal.complete_frontend_video_upload(uuid,integer,text,text,integer);


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
  new.state_changed_at := case when new.state <> old.state then statement_timestamp() else old.state_changed_at end;
  return new;
end;
$$;
revoke all on function internal.media_object_transition_guard() from public, anon, authenticated, service_role;

alter table private.media_objects drop column if exists duration_ms;

notify pgrst,'reload schema';
commit;
