-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.confirm_frontend_privacy_export(p_case uuid, p_revision integer, p_export uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.confirm_frontend_privacy_export(p_case,p_revision,p_export)$function$;
alter function api.confirm_frontend_privacy_export(uuid,integer,uuid) owner to postgres;
revoke all on function api.confirm_frontend_privacy_export(uuid,integer,uuid) from public;
grant execute on function api.confirm_frontend_privacy_export(uuid,integer,uuid) to authenticated;
