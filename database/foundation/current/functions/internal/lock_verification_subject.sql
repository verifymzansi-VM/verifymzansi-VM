-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_verification_subject(p_owner uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.lock_evidence_subject(p_owner);
  perform c.id from private.evidence_cases c where c.subject_id=p_owner order by c.id for update;
end;
$function$;
alter function internal.lock_verification_subject(uuid) owner to postgres;
revoke all on function internal.lock_verification_subject(uuid) from public;
