-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.place_evidence_fraud_hold(p_case_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.place_evidence_fraud_hold(p_case_id,p_reason);
$function$;
alter function api.place_evidence_fraud_hold(uuid,text) owner to postgres;
revoke all on function api.place_evidence_fraud_hold(uuid,text) from public;
grant execute on function api.place_evidence_fraud_hold(uuid,text) to authenticated;
