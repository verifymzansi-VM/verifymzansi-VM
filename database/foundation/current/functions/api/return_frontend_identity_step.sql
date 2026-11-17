-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.return_frontend_identity_step(p_case uuid, p_submission uuid, p_artifact uuid, p_expected_version integer, p_claim_generation text, p_claim_nonce uuid, p_decision text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.return_frontend_identity_step(p_case,p_submission,p_artifact,p_expected_version,p_claim_generation,p_claim_nonce,p_decision,p_reason)$function$;
alter function api.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) owner to postgres;
revoke all on function api.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) from public;
grant execute on function api.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) to authenticated;
