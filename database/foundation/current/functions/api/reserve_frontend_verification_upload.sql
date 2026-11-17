-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reserve_frontend_verification_upload(p_request uuid, p_purpose text, p_digest text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
 select internal.reserve_frontend_verification_upload(p_request,p_purpose,p_digest,p_first_name,p_last_name);
$function$;
alter function api.reserve_frontend_verification_upload(uuid,text,text,text,text) owner to postgres;
revoke all on function api.reserve_frontend_verification_upload(uuid,text,text,text,text) from public;
grant execute on function api.reserve_frontend_verification_upload(uuid,text,text,text,text) to authenticated;
