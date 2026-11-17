-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.my_queue_claims()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.my_queue_claims();
$function$;
alter function api.my_queue_claims() owner to postgres;
revoke all on function api.my_queue_claims() from public;
grant execute on function api.my_queue_claims() to authenticated;
