-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.verify_frontend_cipc_email(p_owner uuid, p_session uuid, p_business uuid, p_case uuid, p_digest text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.verify_frontend_cipc_email(p_owner,p_session,p_business,p_case,p_digest)$function$;
alter function api.verify_frontend_cipc_email(uuid,uuid,uuid,uuid,text) owner to postgres;
revoke all on function api.verify_frontend_cipc_email(uuid,uuid,uuid,uuid,text) from public;
grant execute on function api.verify_frontend_cipc_email(uuid,uuid,uuid,uuid,text) to service_role;
