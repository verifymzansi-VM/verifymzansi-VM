-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.staff_identity_review_context(p_case uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_identity_review_context(p_case,p_claim_generation,p_claim_nonce);
$function$;
alter function api.staff_identity_review_context(uuid,text,uuid) owner to postgres;
revoke all on function api.staff_identity_review_context(uuid,text,uuid) from public;
grant execute on function api.staff_identity_review_context(uuid,text,uuid) to authenticated;
