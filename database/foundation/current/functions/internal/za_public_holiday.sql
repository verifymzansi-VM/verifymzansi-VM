-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.za_public_holiday(p_day date)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  -- Month * 100 + day of each fixed date.
  fixed constant integer[] := array[101, 321, 427, 501, 616, 809, 924, 1216, 1225, 1226];
  md integer; y integer; a integer; b integer; c integer; d integer; e integer; f integer; g integer; h integer;
  i integer; k integer; l integer; m integer; easter date;
begin
  if p_day is null then return null; end if;
  md := extract(month from p_day)::integer * 100 + extract(day from p_day)::integer;
  -- The fixed dates of the Public Holidays Act.
  if md = any(fixed) then return true; end if;
  -- A public holiday on a Sunday: the Monday after it is one.
  if extract(isodow from p_day) = 1
      and extract(month from p_day - 1)::integer * 100 + extract(day from p_day - 1)::integer = any(fixed) then
    return true;
  end if;
  -- Christmas on a Sunday: the Monday is already the Day of Goodwill, so the
  -- Tuesday (27 December) is kept free as well.
  if md = 1227 and extract(isodow from p_day) = 2 then return true; end if;
  -- Good Friday and Family Day (the Monday after Easter Sunday). Easter
  -- Sunday by the Gregorian calendar (the anonymous algorithm).
  y := extract(year from p_day)::integer;
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  easter := make_date(y, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
  return p_day = easter - 2 or p_day = easter + 1;
end;
$function$;
alter function internal.za_public_holiday(date) owner to postgres;
revoke all on function internal.za_public_holiday(date) from public;
