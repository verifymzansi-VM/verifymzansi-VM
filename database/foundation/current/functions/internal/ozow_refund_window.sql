-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.ozow_refund_window()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Ozow refunds a payment up to 14 days after it; one day less, for time zones
  -- and Ozow's own clock (owner's decision of 18 November 2026).
  select interval '13 days';
$function$;
alter function internal.ozow_refund_window() owner to postgres;
revoke all on function internal.ozow_refund_window() from public;
