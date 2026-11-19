-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.house_slots_on_staff_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare v_user uuid; v_slot uuid;
begin
  if tg_op='DELETE' then
    v_user:=old.user_id;
  else
    v_user:=new.user_id;
  end if;
  if exists(select 1 from private.staff_roles r where r.user_id=v_user and r.role='admin' and r.revoked_at is null) then
    return null;
  end if;
  for v_slot in select e.id from private.entitlements e
      where e.owner_id=v_user and e.source='staff_grant' and e.status<>'revoked' and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)
      -- The order internal.activate_post locks slots in, so they never deadlock.
      order by e.ends_at, e.id loop
    perform internal.end_house_slot(v_slot, 'Admin role removed');
  end loop;
  return null;
end;
$function$;
alter function internal.house_slots_on_staff_role_change() owner to postgres;
revoke all on function internal.house_slots_on_staff_role_change() from public;
