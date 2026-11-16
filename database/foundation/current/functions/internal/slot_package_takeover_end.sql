-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_takeover_end(p_entitlement uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare v_owner uuid; v_chain uuid; v_package uuid; v_places integer; v_ends timestamptz; v_rank bigint;
begin
  select e.owner_id, coalesce(e.slot_id, e.id) into v_owner, v_chain from private.entitlements e
    where e.id = p_entitlement and e.package_id is null and e.source = 'retail_paid';
  if v_owner is null then
    return null;
  end if;
  select n.package_id, n.places, n.ends_at into v_package, v_places, v_ends from internal.slot_package_now(v_owner) n;
  if v_package is null then
    return null;
  end if;
  select min(w.place_rank) into v_rank from internal.slot_package_waiting(v_package) w where w.slot_chain = v_chain;
  if v_rank is null or v_rank > v_places - internal.slot_package_posts(v_package) then
    return null;
  end if;
  return v_ends;
end;
$function$;
alter function internal.slot_package_takeover_end(uuid) owner to postgres;
revoke all on function internal.slot_package_takeover_end(uuid) from public;
