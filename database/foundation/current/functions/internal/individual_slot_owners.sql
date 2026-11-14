-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_slot_owners(p_identity text, p_owner uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select o.id from (
    select p_owner as id
    union
    select f.owner_id from private.accepted_identity_facts f where p_identity is not null and f.identity_hmac=p_identity
  ) o
  where exists(select 1 from auth.users u where u.id=o.id and u.deleted_at is null)
    and not exists(select 1 from private.account_closures c where c.user_id=o.id)
    and not exists(select 1 from private.decisions d
      join private.evidence_cases c on c.id=d.case_id
      left join private.frontend_account_restrictions x on x.decision_id=d.id and not x.emergency
      where c.subject_id=o.id and d.status='approved' and d.action='restrict_account'
        and d.scope_kind in ('native','report_ban') and x.lifted_at is null);
$function$;
alter function internal.individual_slot_owners(text,uuid) owner to postgres;
revoke all on function internal.individual_slot_owners(text,uuid) from public;
