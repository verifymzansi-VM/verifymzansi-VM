-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_business_identity_reviewed(p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.accepted_identity_facts f join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases c on c.id=s.case_id and c.subject_id=p_owner
    where f.owner_id=p_owner and f.revoked_at is null and c.status='decided' and c.version=s.case_version+1
      and internal.verification_evidence_reviewed(s.id));
$function$;
alter function internal.frontend_business_identity_reviewed(uuid) owner to postgres;
revoke all on function internal.frontend_business_identity_reviewed(uuid) from public;
