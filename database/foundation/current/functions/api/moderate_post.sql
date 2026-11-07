-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_claim_generation text, p_claim_nonce uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.moderate_post(p_post_id, p_expected_revision, p_decision, p_reason, p_claim_generation, p_claim_nonce);
$function$;
alter function api.moderate_post(uuid,integer,text,text,uuid,text) owner to postgres;
revoke all on function api.moderate_post(uuid,integer,text,text,uuid,text) from public;
grant execute on function api.moderate_post(uuid,integer,text,text,uuid,text) to authenticated;
