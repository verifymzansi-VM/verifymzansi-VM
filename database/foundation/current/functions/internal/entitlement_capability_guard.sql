-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.entitlement_capability_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.addon_capabilities is distinct from old.addon_capabilities then
    raise exception 'issued capabilities are immutable; issue a reviewed replacement grant' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.entitlement_capability_guard() owner to postgres;
revoke all on function internal.entitlement_capability_guard() from public;
