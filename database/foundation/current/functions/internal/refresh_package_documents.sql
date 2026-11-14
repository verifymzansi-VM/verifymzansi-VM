-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refresh_package_documents(p_package uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare owner uuid; ends timestamptz; changed integer;
begin
  select p.owner_id into owner from private.slot_packages p where p.id = p_package;
  select k.ends_at into ends from internal.slot_package_now(owner) k where k.package_id = p_package;
  if ends is null then return 0; end if;
  update private.post_search_documents s set visible_until = ends
  from private.post_activations a
    join private.entitlements x on x.id = a.entitlement_id
    join private.payment_lines l on l.id = x.payment_line_id
    join private.plan_versions v on v.id = l.plan_version_id
  where s.post_id = a.post_id and a.owner_id = owner and a.released_at is null
    and x.package_id is null and x.source = 'retail_paid' and x.status = 'active'
    and internal.individual_slot_plan(v.plan_code)
    and s.is_visible and s.kind <> 'event' and s.visible_until < ends;
  get diagnostics changed = row_count;
  return changed;
end;
$function$;
alter function internal.refresh_package_documents(uuid) owner to postgres;
revoke all on function internal.refresh_package_documents(uuid) from public;
