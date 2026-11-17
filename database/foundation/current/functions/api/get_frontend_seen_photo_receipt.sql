-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_frontend_seen_photo_receipt(p_case uuid, p_artifact uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.get_frontend_seen_photo_receipt(p_case,p_artifact)$function$;
alter function api.get_frontend_seen_photo_receipt(uuid,uuid) owner to postgres;
revoke all on function api.get_frontend_seen_photo_receipt(uuid,uuid) from public;
grant execute on function api.get_frontend_seen_photo_receipt(uuid,uuid) to authenticated;
