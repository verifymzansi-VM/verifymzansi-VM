-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.release_frontend_content_hold(p_hold uuid, p_expected_version integer, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.release_frontend_content_hold(p_hold,p_expected_version,p_reason)$function$;
alter function api.release_frontend_content_hold(uuid,integer,text) owner to postgres;
revoke all on function api.release_frontend_content_hold(uuid,integer,text) from public;
grant execute on function api.release_frontend_content_hold(uuid,integer,text) to authenticated;
