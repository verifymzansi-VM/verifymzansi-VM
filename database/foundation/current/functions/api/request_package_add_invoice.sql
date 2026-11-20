-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.request_package_add_invoice(p_package_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.request_package_add_invoice(p_package_id, p_slots, p_expected_total_cents,
    p_cooling_off_consent, p_request_id);
$function$;
alter function api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) owner to postgres;
revoke all on function api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) from public;
grant execute on function api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) to authenticated;
