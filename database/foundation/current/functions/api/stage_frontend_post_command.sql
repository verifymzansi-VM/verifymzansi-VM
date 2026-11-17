-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.stage_frontend_post_command(p_owner uuid, p_request uuid, p_digest text, p_payload jsonb)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.stage_frontend_post_command(p_owner,p_request,p_digest,p_payload)$function$;
alter function api.stage_frontend_post_command(uuid,uuid,text,jsonb) owner to postgres;
revoke all on function api.stage_frontend_post_command(uuid,uuid,text,jsonb) from public;
grant execute on function api.stage_frontend_post_command(uuid,uuid,text,jsonb) to service_role;
