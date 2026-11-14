-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  raise exception 'a package never changes; its slots and dates are its grants' using errcode='23514';
end;
$function$;
alter function internal.slot_package_guard() owner to postgres;
revoke all on function internal.slot_package_guard() from public;
