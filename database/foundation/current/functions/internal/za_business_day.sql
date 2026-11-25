-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.za_business_day(p_day date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Monday to Friday, except a public holiday (internal.za_public_holiday).
  select extract(isodow from p_day) < 6 and not internal.za_public_holiday(p_day);
$function$;
alter function internal.za_business_day(date) owner to postgres;
revoke all on function internal.za_business_day(date) from public;
