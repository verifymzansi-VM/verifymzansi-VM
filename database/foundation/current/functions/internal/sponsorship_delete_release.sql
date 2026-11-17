-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.sponsorship_delete_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if old.status='active' then perform internal.release_sponsorship_entitlement(old.entitlement_id); end if;
  return old;
end;
$function$;
alter function internal.sponsorship_delete_release() owner to postgres;
revoke all on function internal.sponsorship_delete_release() from public;
