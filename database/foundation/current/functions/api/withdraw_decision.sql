-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.withdraw_decision(p_decision_id uuid, p_expected_version integer, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.withdraw_decision(p_decision_id,p_expected_version,p_reason);
$function$;
alter function api.withdraw_decision(uuid,integer,text) owner to postgres;
revoke all on function api.withdraw_decision(uuid,integer,text) from public;
grant execute on function api.withdraw_decision(uuid,integer,text) to authenticated;
