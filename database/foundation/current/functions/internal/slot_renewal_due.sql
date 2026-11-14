-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_renewal_due(p_entitlement uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.entitlements g
      join private.payment_lines l on l.id=g.payment_line_id and l.payment_id=g.payment_id
      join private.plan_versions v on v.id=l.plan_version_id
      join private.payments pay on pay.id=g.payment_id
    where g.id=p_entitlement and g.owner_id=p_owner and g.status='active' and g.source='retail_paid'
      and internal.individual_slot_plan(v.plan_code) and l.status='open'
      and pay.status='complete' and pay.owner_id=g.owner_id
      and g.starts_at<=clock_timestamp() and g.ends_at>clock_timestamp()
      and not exists(select 1 from private.entitlements n where n.slot_id=coalesce(g.slot_id,g.id)
        and n.id<>g.id and n.status='active' and n.starts_at<=g.ends_at and n.ends_at>g.ends_at)
      and exists(select 1 from private.current_account_access a where a.id=g.owner_id));
$function$;
alter function internal.slot_renewal_due(uuid,uuid) owner to postgres;
revoke all on function internal.slot_renewal_due(uuid,uuid) from public;
