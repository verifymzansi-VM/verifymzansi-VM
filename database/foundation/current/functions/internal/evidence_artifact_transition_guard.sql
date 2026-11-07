-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_artifact_transition_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id, new.case_id, new.owner_id, new.purpose, new.object_key) is distinct from
     (old.id, old.case_id, old.owner_id, old.purpose, old.object_key) then
    raise exception 'artifact identity is immutable' using errcode = '23514';
  end if;
  if new.state <> old.state and not (
      (old.state = 'intent' and new.state in ('uploaded', 'cleanup_required'))
      or (old.state = 'uploaded' and new.state in ('clean', 'rejected', 'cleanup_required'))
      or (old.state in ('clean', 'rejected') and new.state = 'cleanup_required')
      or (old.state = 'cleanup_required' and new.state = 'deleted')) then
    raise exception 'invalid artifact transition % -> %', old.state, new.state using errcode = '23514';
  end if;
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then
    raise exception 'artifact digest is immutable' using errcode = '23514';
  end if;
  new.state_changed_at := case when new.state <> old.state then statement_timestamp() else old.state_changed_at end;
  return new;
end;
$function$;
alter function internal.evidence_artifact_transition_guard() owner to postgres;
revoke all on function internal.evidence_artifact_transition_guard() from public;
