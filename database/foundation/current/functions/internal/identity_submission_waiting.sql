-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_submission_waiting(p_submission uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.verification_current_submissions v
    join private.evidence_cases c on c.id=v.case_id
    join private.verification_identity_submissions s on s.id=v.submission_id
    where v.submission_id=p_submission and c.status='open' and c.version=s.case_version);
$function$;
alter function internal.identity_submission_waiting(uuid) owner to postgres;
revoke all on function internal.identity_submission_waiting(uuid) from public;
