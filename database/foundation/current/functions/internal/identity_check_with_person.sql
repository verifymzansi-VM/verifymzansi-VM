-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_check_with_person(k private.identity_checks)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select k.asked_at is not null and exists(select 1 from private.evidence_cases c
    join private.verification_current_submissions v on v.case_id=c.id and v.submission_id=k.submission_id
    join private.verification_identity_submissions s on s.id=k.submission_id
    where c.id=k.case_id and c.status='open' and c.version=s.case_version);
$function$;
alter function internal.identity_check_with_person(private.identity_checks) owner to postgres;
revoke all on function internal.identity_check_with_person(private.identity_checks) from public;
