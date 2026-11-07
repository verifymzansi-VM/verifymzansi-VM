-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.identity_status(p_identity_hmac text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.identity_status(p_identity_hmac);
$function$;
alter function api.identity_status(text) owner to postgres;
revoke all on function api.identity_status(text) from public;
grant execute on function api.identity_status(text) to service_role;
