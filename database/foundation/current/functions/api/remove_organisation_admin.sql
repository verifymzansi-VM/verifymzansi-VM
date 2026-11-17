-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.remove_organisation_admin(p_org uuid, p_account uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.remove_organisation_admin(p_org,p_account,p_reason);
$function$;
alter function api.remove_organisation_admin(uuid,uuid,text) owner to postgres;
revoke all on function api.remove_organisation_admin(uuid,uuid,text) from public;
grant execute on function api.remove_organisation_admin(uuid,uuid,text) to authenticated;
