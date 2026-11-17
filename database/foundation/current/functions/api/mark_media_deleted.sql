-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.mark_media_deleted(p_object_id uuid, p_claim_token uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.mark_media_deleted(p_object_id,p_claim_token);
$function$;
alter function api.mark_media_deleted(uuid,uuid) owner to postgres;
revoke all on function api.mark_media_deleted(uuid,uuid) from public;
grant execute on function api.mark_media_deleted(uuid,uuid) to service_role;
