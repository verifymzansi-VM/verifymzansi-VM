-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.first_purchase_last_ask_day(p_confirmed timestamp with time zone)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare day date; counted integer := 0;
begin
  -- The 5th business day after the day the payment was confirmed (South
  -- African time): the last day a customer may ask to cancel a first purchase.
  if p_confirmed is null then return null; end if;
  day := (p_confirmed at time zone 'Africa/Johannesburg')::date;
  while counted < 5 loop
    day := day + 1;
    if internal.za_business_day(day) then counted := counted + 1; end if;
  end loop;
  return day;
end;
$function$;
alter function internal.first_purchase_last_ask_day(timestamp with time zone) owner to postgres;
revoke all on function internal.first_purchase_last_ask_day(timestamp with time zone) from public;
