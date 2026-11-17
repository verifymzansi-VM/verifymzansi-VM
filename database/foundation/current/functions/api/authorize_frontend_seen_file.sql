-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.authorize_frontend_seen_file(p_artifact uuid, p_record boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.authorize_frontend_seen_file(p_artifact,p_record)$function$;
alter function api.authorize_frontend_seen_file(uuid,boolean) owner to postgres;
revoke all on function api.authorize_frontend_seen_file(uuid,boolean) from public;
grant execute on function api.authorize_frontend_seen_file(uuid,boolean) to authenticated;
