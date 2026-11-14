-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_slots_extended(p_identity text, p_owner uuid, p_exclude uuid, p_chains uuid[])
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with owners as (select internal.individual_slot_owners(p_identity, p_owner) as id),
  chains as (
    select e.slot_id as chain from private.entitlements e
      join private.payment_lines l on l.id=e.payment_line_id
      join private.plan_versions v on v.id=l.plan_version_id
    where e.owner_id in (select id from owners) and e.source='retail_paid' and e.status='active'
      and e.slot_id is not null and e.starts_at>clock_timestamp() and internal.individual_slot_plan(v.plan_code)
    union
    select coalesce(t.slot_id, t.id) from private.payment_lines l
      join private.payments p on p.id=l.payment_id
      join private.entitlements t on t.id=l.renews_entitlement_id
    where p.owner_id in (select id from owners) and p.status='pending' and p.id is distinct from p_exclude
      and (p.checkout_expires_at>clock_timestamp() or p.checkout_claim_until>clock_timestamp()
        or (p.checkout_url is null and p.created_at>clock_timestamp()-interval '30 minutes'))
      and internal.slot_chain_held(t.id)
    union
    select c from unnest(coalesce(p_chains, '{}'::uuid[])) c where c is not null
  )
  select count(*)::integer from chains;
$function$;
alter function internal.individual_slots_extended(text,uuid,uuid,uuid[]) owner to postgres;
revoke all on function internal.individual_slots_extended(text,uuid,uuid,uuid[]) from public;
