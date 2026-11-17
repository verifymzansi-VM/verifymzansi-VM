-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_account_erasure(p_request uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_account_erasure(p_request);
$function$;
alter function api.get_account_erasure(uuid) owner to postgres;
revoke all on function api.get_account_erasure(uuid) from public;
grant execute on function api.get_account_erasure(uuid) to authenticated;
