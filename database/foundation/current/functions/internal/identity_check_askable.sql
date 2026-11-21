-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_check_askable(k private.identity_checks)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select k.status='declined' and k.declined_at+interval '5 days'>statement_timestamp()
    and not exists(select 1 from private.frontend_appeals a where a.action_id=k.id)
    and exists(select 1 from private.evidence_cases c join private.verification_identity_submissions s on s.id=k.submission_id
      where c.id=k.case_id and c.status='open' and c.version=s.case_version)
    and not exists(select 1 from private.verification_current_submissions v where v.case_id=k.case_id)
    and not exists(select 1 from private.accepted_identity_facts f where f.owner_id=k.owner_id)
    and not exists(select 1 from private.identity_checks n where n.owner_id=k.owner_id and n.status='started'
      and n.expires_at>statement_timestamp());
$function$;
alter function internal.identity_check_askable(private.identity_checks) owner to postgres;
revoke all on function internal.identity_check_askable(private.identity_checks) from public;
