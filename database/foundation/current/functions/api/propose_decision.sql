-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.propose_decision(p_case_id uuid, p_expected_version integer, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.propose_decision(p_case_id, p_expected_version, p_action, p_payload);
$function$;
alter function api.propose_decision(uuid,integer,text,jsonb) owner to postgres;
revoke all on function api.propose_decision(uuid,integer,text,jsonb) from public;
grant execute on function api.propose_decision(uuid,integer,text,jsonb) to authenticated;
