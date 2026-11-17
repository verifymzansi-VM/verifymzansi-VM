-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.claim_media_cleanup(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_media_cleanup(p_limit);
$function$;
alter function api.claim_media_cleanup(integer) owner to postgres;
revoke all on function api.claim_media_cleanup(integer) from public;
grant execute on function api.claim_media_cleanup(integer) to service_role;
