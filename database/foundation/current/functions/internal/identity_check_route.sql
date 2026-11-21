-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_check_route(p_owner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare s private.identity_check_settings;
begin
  select x.* into s from private.identity_check_settings x where x.id;
  if not found or s.mode='manual' then
    return jsonb_build_object('route','manual','reason','mode'); end if;
  if s.paused_until>clock_timestamp() then
    return jsonb_build_object('route','manual','reason','paused'); end if;
  -- Spending guard: 3 checks per member in 7 days, 60 a day site-wide. A check
  -- that could not start (unavailable) is not counted.
  if (select count(*) from private.identity_checks k where k.owner_id=p_owner and k.status<>'unavailable'
      and k.created_at>clock_timestamp()-interval '7 days')>=3
    or (select count(*) from private.identity_checks k where k.status<>'unavailable'
      and k.created_at>clock_timestamp()-interval '1 day')>=60 then
    return jsonb_build_object('route','manual','reason','limit'); end if;
  return jsonb_build_object('route','automatic','reason',null);
end$function$;
alter function internal.identity_check_route(uuid) owner to postgres;
revoke all on function internal.identity_check_route(uuid) from public;
