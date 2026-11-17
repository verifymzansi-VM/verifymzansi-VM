-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.inbox_page_limit(p_limit integer, p_before_created timestamp with time zone, p_before_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_limit is null or p_limit not between 1 and 50 or (p_before_created is null)<>(p_before_id is null) then
    raise exception 'invalid inbox page' using errcode='22023',detail='inbox_page_invalid'; end if;
end;
$function$;
alter function internal.inbox_page_limit(integer,timestamp with time zone,uuid) owner to postgres;
revoke all on function internal.inbox_page_limit(integer,timestamp with time zone,uuid) from public;
