-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_last_admin_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if old.role = 'admin' and old.revoked_at is null
    and (new.revoked_at is not null or new.role <> 'admin')
    and not exists (select 1 from private.staff_roles r where r.role = 'admin' and r.revoked_at is null and r.id <> old.id) then
    raise exception 'the last active administrator cannot be removed' using errcode = '23514';
  end if;
  return new;
end;
$function$;
alter function internal.staff_last_admin_guard() owner to postgres;
revoke all on function internal.staff_last_admin_guard() from public;
