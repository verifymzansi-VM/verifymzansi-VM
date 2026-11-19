-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_move_failed(p_package uuid, p_post uuid, p_direction text, p_sqlstate text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare v_now timestamptz := clock_timestamp();
  v_reason text := case when p_sqlstate = '55P03' then 'busy' else 'error ' || p_sqlstate end;
begin
  update private.slot_package_move_failures f set
      tries = case when f.last_failed_at < v_now - interval '15 minutes' then 1 else f.tries + 1 end,
      first_failed_at = case when f.last_failed_at < v_now - interval '15 minutes' then v_now else f.first_failed_at end,
      alerted_at = case when f.last_failed_at < v_now - interval '15 minutes' then null else f.alerted_at end,
      last_failed_at = v_now, reason = v_reason
    where f.package_id = p_package and f.post_id is not distinct from p_post and f.direction = p_direction;
  if not found then
    insert into private.slot_package_move_failures (package_id, post_id, direction, first_failed_at, last_failed_at, reason)
      values (p_package, p_post, p_direction, v_now, v_now, v_reason);
  end if;
end;
$function$;
alter function internal.slot_package_move_failed(uuid,uuid,text,text) owner to postgres;
revoke all on function internal.slot_package_move_failed(uuid,uuid,text,text) from public;
