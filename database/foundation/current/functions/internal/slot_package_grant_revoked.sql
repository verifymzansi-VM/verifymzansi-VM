-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_grant_revoked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.slot_package_release_dates(new.owner_id);
  return null;
end;
$function$;
alter function internal.slot_package_grant_revoked() owner to postgres;
revoke all on function internal.slot_package_grant_revoked() from public;
