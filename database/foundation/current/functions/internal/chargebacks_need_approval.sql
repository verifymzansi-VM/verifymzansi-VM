-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.chargebacks_need_approval()
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select true;
$function$;
alter function internal.chargebacks_need_approval() owner to postgres;
revoke all on function internal.chargebacks_need_approval() from public;
