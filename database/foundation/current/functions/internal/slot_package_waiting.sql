-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_waiting(p_package uuid, p_ahead interval DEFAULT '00:00:00'::interval)
 RETURNS TABLE(activation_id uuid, post_id uuid, entitlement_id uuid, slot_chain uuid, ended_at timestamp with time zone, place_rank bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_column
declare v_owner uuid; v_since timestamptz;
begin
  select p.owner_id into v_owner from private.slot_packages p where p.id = p_package;
  select n.starts_at into v_since from internal.slot_package_now(v_owner) n where n.package_id = p_package;
  if v_since is null then
    return;
  end if;
  -- The owner's posts still held in an Individual slot whose own period has
  -- ended (or ends within p_ahead): an index read of the posts they hold; the
  -- slot's paid run is followed only for those.
  return query
    select w.id, w.post_id, w.entitlement_id, w.chain, w.ended_at,
      row_number() over (order by w.ended_at, w.id)
    from (
      select a.id, a.post_id, a.entitlement_id, coalesce(x.slot_id, x.id) as chain,
        internal.slot_chain_paid_end(x.id) as ended_at
      from private.post_activations a
        join private.entitlements x on x.id = a.entitlement_id
        join private.payment_lines l on l.id = x.payment_line_id
        join private.plan_versions v on v.id = l.plan_version_id
      where a.owner_id = v_owner and a.released_at is null and a.post_id is not null
        and x.package_id is null and x.source = 'retail_paid' and x.status = 'active' and x.owner_id = v_owner
        and x.ends_at <= statement_timestamp() + p_ahead and internal.individual_slot_plan(v.plan_code)
      offset 0
    ) w
    where w.ended_at <= statement_timestamp() + p_ahead and w.ended_at > v_since;
end;
$function$;
alter function internal.slot_package_waiting(uuid,interval) owner to postgres;
revoke all on function internal.slot_package_waiting(uuid,interval) from public;
