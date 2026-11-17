-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.set_frontend_cipc_office_visibility(p_business uuid, p_show boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.set_frontend_cipc_office_visibility(p_business,p_show)$function$;
alter function api.set_frontend_cipc_office_visibility(uuid,boolean) owner to postgres;
revoke all on function api.set_frontend_cipc_office_visibility(uuid,boolean) from public;
grant execute on function api.set_frontend_cipc_office_visibility(uuid,boolean) to authenticated;
