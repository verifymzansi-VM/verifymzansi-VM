-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.org_list_sponsorships(p_org uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.org_list_sponsorships(p_org);
$function$;
alter function api.org_list_sponsorships(uuid) owner to postgres;
revoke all on function api.org_list_sponsorships(uuid) from public;
grant execute on function api.org_list_sponsorships(uuid) to authenticated;
