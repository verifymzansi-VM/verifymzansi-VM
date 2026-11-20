-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_add_quote(p_owner uuid)
 RETURNS TABLE(package_id uuid, term_days integer, plan_id uuid, places integer, ends_at timestamp with time zone, days_left integer, unit_price_cents bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare v_package uuid; v_places integer; v_ends timestamptz; v_term integer; v_days integer;
  v_plan private.plan_versions;
begin
  select n.package_id, n.places, n.ends_at into v_package, v_places, v_ends
    from internal.slot_package_now(p_owner) n;
  if v_package is null then return; end if;
  select k.term_days into v_term from private.slot_packages k where k.id = v_package and k.owner_id = p_owner;
  if v_term is null then return; end if;
  select x.* into v_plan from internal.slot_package_term_plan(v_term) x;
  v_days := floor(extract(epoch from (v_ends - statement_timestamp())) / 86400)::integer;
  return query select v_package, v_term, v_plan.id, v_places, v_ends, v_days,
    case when v_plan.id is null then null::bigint
      else round(v_plan.price_cents::numeric * v_days / v_plan.duration_days)::bigint end;
end;
$function$;
alter function internal.slot_package_add_quote(uuid) owner to postgres;
revoke all on function internal.slot_package_add_quote(uuid) from public;
