-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.identity_disclosure_material(p_disclosure uuid, p_staff uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.identity_disclosure_material(p_disclosure,p_staff);
$function$;
alter function api.identity_disclosure_material(uuid,uuid) owner to postgres;
revoke all on function api.identity_disclosure_material(uuid,uuid) from public;
grant execute on function api.identity_disclosure_material(uuid,uuid) to service_role;
