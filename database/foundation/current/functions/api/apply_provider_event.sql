-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.apply_provider_event(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.apply_provider_event(p_event);
$function$;
alter function api.apply_provider_event(jsonb) owner to postgres;
revoke all on function api.apply_provider_event(jsonb) from public;
grant execute on function api.apply_provider_event(jsonb) to service_role;
