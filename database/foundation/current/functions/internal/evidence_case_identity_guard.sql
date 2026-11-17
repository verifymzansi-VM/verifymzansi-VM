-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_case_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.subject_id,new.kind,new.created_at) is distinct from (old.id,old.subject_id,old.kind,old.created_at) then
    raise exception 'evidence case identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.evidence_case_identity_guard() owner to postgres;
revoke all on function internal.evidence_case_identity_guard() from public;
