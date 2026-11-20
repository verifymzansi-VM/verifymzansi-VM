-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.purge_capture_handoffs(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  delete from private.capture_handoffs h where h.token_sha256 in (
    select x.token_sha256 from private.capture_handoffs x
    where x.expires_at < clock_timestamp() - interval '1 day'
    order by x.expires_at limit p_limit);
  get diagnostics n = row_count;
  return n;
end;
$function$;
alter function internal.purge_capture_handoffs(integer) owner to postgres;
revoke all on function internal.purge_capture_handoffs(integer) from public;
