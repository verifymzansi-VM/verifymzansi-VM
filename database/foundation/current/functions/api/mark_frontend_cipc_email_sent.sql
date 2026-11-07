-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.mark_frontend_cipc_email_sent(p_owner uuid, p_session uuid, p_case uuid, p_challenge uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.mark_frontend_cipc_email_sent(p_owner,p_session,p_case,p_challenge)$function$;
alter function api.mark_frontend_cipc_email_sent(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function api.mark_frontend_cipc_email_sent(uuid,uuid,uuid,uuid) from public;
grant execute on function api.mark_frontend_cipc_email_sent(uuid,uuid,uuid,uuid) to service_role;
