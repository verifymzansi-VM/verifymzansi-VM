-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.decide_frontend_governance(p_decision uuid, p_case uuid, p_expected_version integer, p_proposal_version integer, p_action text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.decide_frontend_governance(p_decision,p_case,p_expected_version,p_proposal_version,p_action,p_reason)$function$;
alter function api.decide_frontend_governance(uuid,uuid,integer,integer,text,text) owner to postgres;
revoke all on function api.decide_frontend_governance(uuid,uuid,integer,integer,text,text) from public;
grant execute on function api.decide_frontend_governance(uuid,uuid,integer,integer,text,text) to authenticated;
