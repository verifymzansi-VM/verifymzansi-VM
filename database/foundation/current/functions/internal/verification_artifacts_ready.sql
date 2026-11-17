-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.verification_artifacts_ready(p_submission uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.verification_identity_submissions s
    join private.evidence_artifacts i on i.id=s.id_artifact_id and i.owner_id=s.owner_id and i.case_id=s.case_id
    join private.evidence_artifacts f on f.id=s.selfie_artifact_id and f.owner_id=s.owner_id and f.case_id=s.case_id
    where s.id=p_submission and i.purpose='id_front' and f.purpose='selfie'
      and i.state='clean' and f.state='clean'
      and (i.retain_until is null or i.retain_until>clock_timestamp())
      and (f.retain_until is null or f.retain_until>clock_timestamp()));
$function$;
alter function internal.verification_artifacts_ready(uuid) owner to postgres;
revoke all on function internal.verification_artifacts_ready(uuid) from public;
