-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.fulfil_account_deletion(p_request uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.fulfil_account_deletion(p_request, p_revision);
$function$;
alter function api.fulfil_account_deletion(uuid,integer) owner to postgres;
revoke all on function api.fulfil_account_deletion(uuid,integer) from public;
grant execute on function api.fulfil_account_deletion(uuid,integer) to authenticated;
