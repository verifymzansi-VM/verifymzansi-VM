-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.claim_evidence_case(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_evidence_case(p_case_id);
$function$;
alter function api.claim_evidence_case(uuid) owner to postgres;
revoke all on function api.claim_evidence_case(uuid) from public;
grant execute on function api.claim_evidence_case(uuid) to authenticated;
