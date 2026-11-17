-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.sponsor_business(p_affiliation uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.sponsor_business(p_affiliation,p_reason);
$function$;
alter function api.sponsor_business(uuid,text) owner to postgres;
revoke all on function api.sponsor_business(uuid,text) from public;
grant execute on function api.sponsor_business(uuid,text) to authenticated;
