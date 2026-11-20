-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.redeem_capture_handoff(p_token_sha256 text, p_grant_sha256 text, p_signed_in uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.redeem_capture_handoff(p_token_sha256,p_grant_sha256,p_signed_in);
$function$;
alter function api.redeem_capture_handoff(text,text,uuid) owner to postgres;
revoke all on function api.redeem_capture_handoff(text,text,uuid) from public;
grant execute on function api.redeem_capture_handoff(text,text,uuid) to service_role;
