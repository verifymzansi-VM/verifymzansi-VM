-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_slots_counted(p_identity text, p_owner uuid, p_exclude uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with owners as (
    select o.id from (
      select p_owner as id
      union
      select f.owner_id from private.accepted_identity_facts f where p_identity is not null and f.identity_hmac=p_identity
    ) o
    -- Slots of an account that lost access for good (closed, deleted, or under
    -- an approved permanent ban that was not lifted) never block the person,
    -- for example after an impostor's account is banned. An account blocked for
    -- a while (an Auth ban with an end, a suspension, an emergency restriction)
    -- keeps counting: its slots come back when the block ends.
    where exists(select 1 from auth.users u where u.id=o.id and u.deleted_at is null)
      and not exists(select 1 from private.account_closures c where c.user_id=o.id)
      and not exists(select 1 from private.decisions d
        join private.evidence_cases c on c.id=d.case_id
        left join private.frontend_account_restrictions x on x.decision_id=d.id and not x.emergency
        where c.subject_id=o.id and d.status='approved' and d.action='restrict_account'
          and d.scope_kind in ('native','report_ban') and x.lifted_at is null)
  )
  select jsonb_build_object(
    'held', (select count(*) from private.entitlements e
        join private.payment_lines l on l.id=e.payment_line_id
        join private.plan_versions v on v.id=l.plan_version_id
      where e.owner_id in (select id from owners) and e.source='retail_paid' and e.status='active'
        and e.ends_at>clock_timestamp() and internal.individual_slot_plan(v.plan_code)),
    'pending', (select count(*) from private.payment_lines l
        join private.payments p on p.id=l.payment_id
        join private.plan_versions v on v.id=l.plan_version_id
      where p.owner_id in (select id from owners) and p.status='pending' and p.id is distinct from p_exclude
        and internal.individual_slot_plan(v.plan_code)
        and (p.checkout_expires_at>clock_timestamp() or p.checkout_claim_until>clock_timestamp()
          or (p.checkout_url is null and p.created_at>clock_timestamp()-interval '30 minutes'))));
$function$;
alter function internal.individual_slots_counted(text,uuid,uuid) owner to postgres;
revoke all on function internal.individual_slots_counted(text,uuid,uuid) from public;
