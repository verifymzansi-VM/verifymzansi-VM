-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.register_identity_submission(p_case uuid, p_expected_version integer, p_id_artifact uuid, p_selfie_artifact uuid, p_fingerprint text, p_identity_key text, p_encrypted_number jsonb, p_receipt uuid, p_risk_score integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.register_identity_submission(p_case,p_expected_version,p_id_artifact,p_selfie_artifact,p_fingerprint,p_identity_key,p_encrypted_number,p_receipt,p_risk_score);
$function$;
alter function api.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) owner to postgres;
revoke all on function api.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) from public;
grant execute on function api.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) to service_role;
