-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_due_after(p_from timestamp with time zone, p_days integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare local_at timestamp; counted integer := 0;
begin
  if p_from is null or p_days is null then return null; end if;
  local_at := p_from at time zone 'Africa/Johannesburg';
  while counted<p_days loop
    local_at := local_at+interval '1 day';
    if extract(isodow from local_at)<6 then counted := counted+1; end if;
  end loop;
  return local_at at time zone 'Africa/Johannesburg';
end;
$function$;
alter function internal.staff_due_after(timestamp with time zone,integer) owner to postgres;
revoke all on function internal.staff_due_after(timestamp with time zone,integer) from public;
