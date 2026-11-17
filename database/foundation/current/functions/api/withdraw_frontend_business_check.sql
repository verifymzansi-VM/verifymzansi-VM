-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.withdraw_frontend_business_check(p_business uuid, p_case uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.withdraw_frontend_business_check(p_business,p_case)$function$;
alter function api.withdraw_frontend_business_check(uuid,uuid) owner to postgres;
revoke all on function api.withdraw_frontend_business_check(uuid,uuid) from public;
grant execute on function api.withdraw_frontend_business_check(uuid,uuid) to authenticated;
