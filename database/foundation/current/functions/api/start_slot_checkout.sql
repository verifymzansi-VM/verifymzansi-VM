-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.start_slot_checkout(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_slot_checkout(p_plan_id, p_slots, p_expected_total_cents, p_cooling_off_consent);
$function$;
alter function api.start_slot_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function api.start_slot_checkout(uuid,integer,bigint,boolean) from public;
grant execute on function api.start_slot_checkout(uuid,integer,bigint,boolean) to authenticated;
