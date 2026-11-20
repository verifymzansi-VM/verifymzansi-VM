-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid DEFAULT NULL::uuid, p_device_issued_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_post_views(p_post_ids, p_device, p_account, p_device_issued_at);
$function$;
alter function api.record_post_views(uuid[],uuid,uuid,timestamp with time zone) owner to postgres;
revoke all on function api.record_post_views(uuid[],uuid,uuid,timestamp with time zone) from public;
grant execute on function api.record_post_views(uuid[],uuid,uuid,timestamp with time zone) to service_role;
