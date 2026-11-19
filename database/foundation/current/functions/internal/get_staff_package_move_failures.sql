-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_package_move_failures()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('payments:view'); result jsonb;
begin
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
      'package_id', f.package_id,
      'owner_name', internal.profile_public_name((select pr.display_name from private.profiles pr
        where pr.account_id = k.owner_id)),
      'post_id', f.post_id, 'post_title', p.title, 'direction', f.direction, 'tries', f.tries,
      'first_failed_at', f.first_failed_at, 'last_failed_at', f.last_failed_at, 'reason', f.reason,
      'package_ends_at', e.ends_at,
      'stuck', internal.slot_package_move_stuck(f.first_failed_at, e.ends_at))
      order by f.first_failed_at, f.id), '[]'::jsonb))
    into result
  from (select x.* from private.slot_package_move_failures x
      where x.last_failed_at >= statement_timestamp() - interval '15 minutes'
      order by x.first_failed_at, x.id limit 50) f
    left join private.slot_packages k on k.id = f.package_id
    left join private.posts p on p.id = f.post_id
    left join lateral (select max(g.ends_at) as ends_at from private.entitlements g
      where g.package_id = f.package_id and g.status = 'active') e on true;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_package_move_failures() owner to postgres;
revoke all on function internal.get_staff_package_move_failures() from public;
grant execute on function internal.get_staff_package_move_failures() to authenticated;
