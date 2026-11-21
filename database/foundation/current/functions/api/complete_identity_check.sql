-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.complete_identity_check(p_check uuid, p_session_id uuid, p_outcome text, p_reasons text[] DEFAULT '{}'::text[], p_id_front jsonb DEFAULT NULL::jsonb, p_selfie jsonb DEFAULT NULL::jsonb, p_identity jsonb DEFAULT NULL::jsonb, p_names jsonb DEFAULT NULL::jsonb, p_risk_score integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_identity_check(p_check,p_session_id,p_outcome,p_reasons,p_id_front,p_selfie,p_identity,p_names,p_risk_score);
$function$;
alter function api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) owner to postgres;
revoke all on function api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) from public;
grant execute on function api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) to service_role;
