-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_free_places(p_owner uuid)
 RETURNS TABLE(entitlement_id uuid, free_places integer, runs_until timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select f.id, f.free, internal.slot_chain_end(f.id)
  from (
    select e.id, e.slot_capacity - internal.slot_posts_held(e.id) as free
    from private.entitlements e
      join private.payment_lines l on l.id = e.payment_line_id
      join private.plan_versions v on v.id = l.plan_version_id
      join private.payments pay on pay.id = e.payment_id and pay.owner_id = e.owner_id and pay.status = 'complete'
    where e.owner_id = p_owner and e.package_id is null and e.source = 'retail_paid' and e.status = 'active'
      and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp()
      and internal.individual_slot_plan(v.plan_code)
      and exists(select 1 from private.current_account_access u where u.id = p_owner)
    offset 0
  ) f
  where f.free > 0;
$function$;
alter function internal.individual_free_places(uuid) owner to postgres;
revoke all on function internal.individual_free_places(uuid) from public;
