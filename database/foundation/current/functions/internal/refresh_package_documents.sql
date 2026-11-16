-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refresh_package_documents(p_package uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare v_owner uuid; v_ends timestamptz; v_free integer; changed integer;
begin
  select p.owner_id into v_owner from private.slot_packages p where p.id = p_package;
  select k.ends_at, k.places - internal.slot_package_posts(p_package) into v_ends, v_free
    from internal.slot_package_now(v_owner) k where k.package_id = p_package;
  if v_ends is null then
    return 0;
  end if;
  update private.post_search_documents s set visible_until = v_ends
  from internal.slot_package_waiting(p_package, interval '2 minutes') w
  where s.post_id = w.post_id and w.place_rank <= v_free
    and s.is_visible and s.kind <> 'event' and s.visible_until < v_ends;
  get diagnostics changed = row_count;
  return changed + internal.slot_package_release_dates(v_owner);
end;
$function$;
alter function internal.refresh_package_documents(uuid) owner to postgres;
revoke all on function internal.refresh_package_documents(uuid) from public;
