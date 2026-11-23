-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_check_clear_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  new.start_first_name:=null;
  new.start_last_name:=null;
  new.network_hash:=null;
  new.device_kind:=null;
  return new;
end$function$;
alter function internal.identity_check_clear_start() owner to postgres;
revoke all on function internal.identity_check_clear_start() from public;
