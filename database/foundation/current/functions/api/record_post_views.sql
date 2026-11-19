-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_post_views(p_post_ids, p_device, p_account);
$function$;
alter function api.record_post_views(uuid[],uuid,uuid) owner to postgres;
revoke all on function api.record_post_views(uuid[],uuid,uuid) from public;
grant execute on function api.record_post_views(uuid[],uuid,uuid) to service_role;
