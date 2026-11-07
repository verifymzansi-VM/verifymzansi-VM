-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.renew_evidence_claim(p_case_id uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.renew_evidence_claim(p_case_id,p_claim_generation,p_claim_nonce);
$function$;
alter function api.renew_evidence_claim(uuid,text,uuid) owner to postgres;
revoke all on function api.renew_evidence_claim(uuid,text,uuid) from public;
grant execute on function api.renew_evidence_claim(uuid,text,uuid) to authenticated;
