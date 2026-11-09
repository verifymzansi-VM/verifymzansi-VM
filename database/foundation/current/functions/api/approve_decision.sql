-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.approve_decision(p_decision_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.approve_decision(p_decision_id);
$function$;
alter function api.approve_decision(uuid) owner to postgres;
revoke all on function api.approve_decision(uuid) from public;
grant execute on function api.approve_decision(uuid) to authenticated;
