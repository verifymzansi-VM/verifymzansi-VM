-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.release_evidence_claim(p_case uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$ select internal.release_evidence_claim(p_case,p_claim_generation,p_claim_nonce); $function$;
alter function api.release_evidence_claim(uuid,text,uuid) owner to postgres;
revoke all on function api.release_evidence_claim(uuid,text,uuid) from public;
grant execute on function api.release_evidence_claim(uuid,text,uuid) to authenticated;
