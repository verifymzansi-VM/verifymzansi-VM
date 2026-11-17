-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.online_payment_max_cents()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 130000::bigint;
$function$;
alter function internal.online_payment_max_cents() owner to postgres;
revoke all on function internal.online_payment_max_cents() from public;
