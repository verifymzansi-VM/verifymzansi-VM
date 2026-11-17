-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.complete_frontend_privacy_notice(p_job uuid, p_claim uuid, p_delivered boolean)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.complete_frontend_privacy_notice(p_job,p_claim,p_delivered)$function$;
alter function api.complete_frontend_privacy_notice(uuid,uuid,boolean) owner to postgres;
revoke all on function api.complete_frontend_privacy_notice(uuid,uuid,boolean) from public;
grant execute on function api.complete_frontend_privacy_notice(uuid,uuid,boolean) to service_role;
