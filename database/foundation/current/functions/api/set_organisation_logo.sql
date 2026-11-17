-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.set_organisation_logo(p_id uuid, p_expected_revision integer, p_reason text, p_object_id uuid DEFAULT NULL::uuid, p_permission_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_organisation_logo(p_id,p_expected_revision,p_object_id,p_permission_reference,p_reason);
$function$;
alter function api.set_organisation_logo(uuid,integer,text,uuid,text) owner to postgres;
revoke all on function api.set_organisation_logo(uuid,integer,text,uuid,text) from public;
grant execute on function api.set_organisation_logo(uuid,integer,text,uuid,text) to authenticated;
