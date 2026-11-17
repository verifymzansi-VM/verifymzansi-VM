-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_slots_counted(p_identity text, p_owner uuid, p_exclude uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with owners as (select internal.individual_slot_owners(p_identity, p_owner) as id)
  select jsonb_build_object(
    -- Slots held: each slot once, whatever renewals it has queued.
    'held', (select count(distinct coalesce(e.slot_id, e.id)) from private.entitlements e
        join private.payment_lines l on l.id=e.payment_line_id
        join private.plan_versions v on v.id=l.plan_version_id
      where e.owner_id in (select id from owners) and e.source='retail_paid' and e.status='active'
        and e.ends_at>clock_timestamp() and internal.individual_slot_plan(v.plan_code)),
    -- Slots in payments still open at Ozow that would add a slot: a new slot,
    -- or a renewal of a slot that is no longer held.
    'pending', (select count(*) from private.payment_lines l
        join private.payments p on p.id=l.payment_id
        join private.plan_versions v on v.id=l.plan_version_id
      where p.owner_id in (select id from owners) and p.status='pending' and p.id is distinct from p_exclude
        and internal.individual_slot_plan(v.plan_code)
        and (p.checkout_expires_at>clock_timestamp() or p.checkout_claim_until>clock_timestamp()
          or (p.checkout_url is null and p.created_at>clock_timestamp()-interval '30 minutes'))
        and (l.renews_entitlement_id is null or not internal.slot_chain_held(l.renews_entitlement_id))));
$function$;
alter function internal.individual_slots_counted(text,uuid,uuid) owner to postgres;
revoke all on function internal.individual_slots_counted(text,uuid,uuid) from public;
