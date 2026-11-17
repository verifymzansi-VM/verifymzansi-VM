-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.switch_frontend_cipc_representative(p_business uuid, p_case uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.switch_frontend_cipc_representative(p_business,p_case)$function$;
alter function api.switch_frontend_cipc_representative(uuid,uuid) owner to postgres;
revoke all on function api.switch_frontend_cipc_representative(uuid,uuid) from public;
grant execute on function api.switch_frontend_cipc_representative(uuid,uuid) to authenticated;
