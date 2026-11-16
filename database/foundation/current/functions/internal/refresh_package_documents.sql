-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refresh_package_documents(p_package uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare v_owner uuid; v_ends timestamptz; v_free integer; changed integer := 0;
begin
  select p.owner_id into v_owner from private.slot_packages p where p.id = p_package;
  select k.ends_at, k.places - internal.slot_package_posts(p_package) into v_ends, v_free
    from internal.slot_package_now(v_owner) k where k.package_id = p_package;
  if v_ends is not null then
    with locked as (
      select s.post_id from private.post_search_documents s
        join internal.slot_package_waiting(p_package, interval '2 minutes') w on w.post_id = s.post_id
      where w.place_rank <= v_free and s.is_visible and s.kind <> 'event' and s.visible_until < v_ends
      for update of s skip locked
    )
    update private.post_search_documents s set visible_until = v_ends from locked l
    where s.post_id = l.post_id;
    get diagnostics changed = row_count;
  end if;
  return changed + internal.slot_package_release_dates(v_owner);
end;
$function$;
alter function internal.refresh_package_documents(uuid) owner to postgres;
revoke all on function internal.refresh_package_documents(uuid) from public;
