-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.staff_evidence_metadata(p_case_id uuid, p_claim_generation text, p_claim_nonce uuid, p_purpose text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_evidence_metadata(p_case_id,p_claim_generation,p_claim_nonce,p_purpose);
$function$;
alter function api.staff_evidence_metadata(uuid,text,uuid,text) owner to postgres;
revoke all on function api.staff_evidence_metadata(uuid,text,uuid,text) from public;
grant execute on function api.staff_evidence_metadata(uuid,text,uuid,text) to authenticated;
