-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reserve_frontend_cipc_document(p_business uuid, p_number text, p_route text, p_office boolean, p_digest text, p_case uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.reserve_frontend_cipc_document(p_business,p_number,p_route,p_office,p_digest,p_case)$function$;
alter function api.reserve_frontend_cipc_document(uuid,text,text,boolean,text,uuid) owner to postgres;
revoke all on function api.reserve_frontend_cipc_document(uuid,text,text,boolean,text,uuid) from public;
grant execute on function api.reserve_frontend_cipc_document(uuid,text,text,boolean,text,uuid) to authenticated;
