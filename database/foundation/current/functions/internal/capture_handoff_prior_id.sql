-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.capture_handoff_prior_id(p_owner uuid, p_case uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select r.request_id from private.frontend_verification_uploads r
    join private.evidence_artifacts a on a.id=r.artifact_id and a.owner_id=r.owner_id and a.case_id=r.case_id
    where r.owner_id=p_owner and r.case_id=p_case and r.purpose='id_front'
      and r.completed_at is not null and r.expires_at>clock_timestamp() and r.fingerprint is not null
      and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp())
    order by r.created_at desc,r.request_id limit 1;
$function$;
alter function internal.capture_handoff_prior_id(uuid,uuid) owner to postgres;
revoke all on function internal.capture_handoff_prior_id(uuid,uuid) from public;
