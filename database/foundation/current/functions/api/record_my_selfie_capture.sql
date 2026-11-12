-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_my_selfie_capture(p_request uuid, p_capture_method text, p_browser_liveness_passed boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
 select internal.record_my_selfie_capture(p_request,p_capture_method,p_browser_liveness_passed);
$function$;
alter function api.record_my_selfie_capture(uuid,text,boolean) owner to postgres;
revoke all on function api.record_my_selfie_capture(uuid,text,boolean) from public;
grant execute on function api.record_my_selfie_capture(uuid,text,boolean) to authenticated;
