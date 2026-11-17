-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.current_verified_identity(p_owner uuid)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select f.identity_hmac from private.accepted_identity_facts f
    join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases c on c.id=s.case_id and c.subject_id=p_owner
  where f.owner_id=p_owner and f.revoked_at is null and c.status='decided' and c.version=s.case_version+1
    and internal.verification_evidence_reviewed(s.id)
    and exists(select 1 from private.current_account_access a where a.id=p_owner)
    and exists(select 1 from private.verification_phone_proofs p where p.owner_id=p_owner and p.revoked_at is null)
    and exists(select 1 from private.verification_localities l where l.owner_id=p_owner);
$function$;
alter function internal.current_verified_identity(uuid) owner to postgres;
revoke all on function internal.current_verified_identity(uuid) from public;
