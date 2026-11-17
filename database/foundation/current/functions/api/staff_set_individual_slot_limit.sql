-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.staff_set_individual_slot_limit(p_account_id uuid, p_slot_limit integer, p_ends_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_set_individual_slot_limit(p_account_id, p_slot_limit, p_ends_at, p_reason);
$function$;
alter function api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) owner to postgres;
revoke all on function api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) from public;
grant execute on function api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) to authenticated;
