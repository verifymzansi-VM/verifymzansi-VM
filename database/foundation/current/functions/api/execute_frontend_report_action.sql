-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.execute_frontend_report_action(p_report uuid, p_expected_revision integer, p_claim_generation text, p_claim_nonce uuid, p_action text, p_reason text, p_duration_days integer DEFAULT NULL::integer, p_emergency boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.execute_frontend_report_action(p_report,p_expected_revision,p_claim_generation,p_claim_nonce,p_action,p_reason,p_duration_days,p_emergency)$function$;
alter function api.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) owner to postgres;
revoke all on function api.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) from public;
grant execute on function api.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) to authenticated;
