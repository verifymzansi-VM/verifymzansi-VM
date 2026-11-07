-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.lift_frontend_account_restriction(p_restriction uuid, p_expected_version integer, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.lift_frontend_account_restriction(p_restriction,p_expected_version,p_reason)$function$;
alter function api.lift_frontend_account_restriction(uuid,integer,text) owner to postgres;
revoke all on function api.lift_frontend_account_restriction(uuid,integer,text) from public;
grant execute on function api.lift_frontend_account_restriction(uuid,integer,text) to authenticated;
