-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.execute_frontend_report_action_v2(p_report uuid, p_expected_revision integer, p_claim_generation text, p_claim_nonce uuid, p_action text, p_reason text, p_duration_days integer DEFAULT NULL::integer, p_emergency boolean DEFAULT false, p_expected_post_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.execute_frontend_report_action_v2(p_report,p_expected_revision,p_claim_generation,p_claim_nonce,p_action,p_reason,p_duration_days,p_emergency,p_expected_post_revision)$function$;
alter function api.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) owner to postgres;
revoke all on function api.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) from public;
grant execute on function api.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) to authenticated;
