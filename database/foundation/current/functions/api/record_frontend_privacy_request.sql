-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_frontend_privacy_request(p_account uuid, p_session uuid, p_type text, p_name text, p_last_four text, p_details text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.record_frontend_privacy_request(p_account,p_session,p_type,p_name,p_last_four,p_details)$function$;
alter function api.record_frontend_privacy_request(uuid,uuid,text,text,text,text) owner to postgres;
revoke all on function api.record_frontend_privacy_request(uuid,uuid,text,text,text,text) from public;
grant execute on function api.record_frontend_privacy_request(uuid,uuid,text,text,text,text) to service_role;
