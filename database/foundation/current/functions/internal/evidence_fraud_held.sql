-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_fraud_held(p_case uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.evidence_fraud_holds h where h.case_id=p_case and h.closed_at is null);
$function$;
alter function internal.evidence_fraud_held(uuid) owner to postgres;
revoke all on function internal.evidence_fraud_held(uuid) from public;
