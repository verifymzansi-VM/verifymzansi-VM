-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.grant_verified_intro_trial(p_owner uuid, p_days integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.grant_verified_intro_trial(p_owner,p_days);
$function$;
alter function api.grant_verified_intro_trial(uuid,integer) owner to postgres;
revoke all on function api.grant_verified_intro_trial(uuid,integer) from public;
grant execute on function api.grant_verified_intro_trial(uuid,integer) to service_role;
