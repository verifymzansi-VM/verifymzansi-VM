-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.review_identity_submission(p_submission uuid, p_expected_version integer, p_claim_generation text, p_claim_nonce uuid, p_number_matches boolean, p_selfie_matches boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.review_identity_submission(p_submission,p_expected_version,p_claim_generation,p_claim_nonce,p_number_matches,p_selfie_matches);
$function$;
alter function api.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) owner to postgres;
revoke all on function api.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) from public;
grant execute on function api.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) to authenticated;
