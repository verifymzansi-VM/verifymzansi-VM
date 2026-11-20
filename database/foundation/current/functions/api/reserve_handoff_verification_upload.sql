-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reserve_handoff_verification_upload(p_grant_sha256 text, p_request uuid, p_purpose text, p_digest text, p_browser_liveness_passed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reserve_handoff_verification_upload(p_grant_sha256,p_request,p_purpose,p_digest,p_browser_liveness_passed);
$function$;
alter function api.reserve_handoff_verification_upload(text,uuid,text,text,boolean) owner to postgres;
revoke all on function api.reserve_handoff_verification_upload(text,uuid,text,text,boolean) from public;
grant execute on function api.reserve_handoff_verification_upload(text,uuid,text,text,boolean) to service_role;
