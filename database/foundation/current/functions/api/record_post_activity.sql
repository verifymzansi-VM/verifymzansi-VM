-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_post_activity(p_post_ids uuid[], p_metrics text[], p_device uuid DEFAULT NULL::uuid, p_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_post_activity(p_post_ids, p_metrics, p_device, p_account);
$function$;
alter function api.record_post_activity(uuid[],text[],uuid,uuid) owner to postgres;
revoke all on function api.record_post_activity(uuid[],text[],uuid,uuid) from public;
grant execute on function api.record_post_activity(uuid[],text[],uuid,uuid) to service_role;
