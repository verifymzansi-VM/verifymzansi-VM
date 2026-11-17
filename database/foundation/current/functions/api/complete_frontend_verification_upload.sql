-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.complete_frontend_verification_upload(p_owner uuid, p_request uuid, p_stored_sha256 text, p_content_sha256 text, p_size integer, p_identity jsonb DEFAULT NULL::jsonb, p_risk_score integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
 select internal.complete_frontend_verification_upload(p_owner,p_request,p_stored_sha256,p_content_sha256,p_size,p_identity,p_risk_score);
$function$;
alter function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) owner to postgres;
revoke all on function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) from public;
grant execute on function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) to service_role;
