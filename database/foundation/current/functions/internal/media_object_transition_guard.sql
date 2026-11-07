-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.media_object_transition_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.media_object_transition_guard() owner to postgres;
revoke all on function internal.media_object_transition_guard() from public;
