-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_organisation_programme(p_org uuid, p_slug text, p_name text, p_reason text, p_description text DEFAULT NULL::text, p_active boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_organisation_programme(p_org,p_slug,p_name,p_description,p_active,p_reason);
$function$;
alter function api.save_organisation_programme(uuid,text,text,text,text,boolean) owner to postgres;
revoke all on function api.save_organisation_programme(uuid,text,text,text,text,boolean) from public;
grant execute on function api.save_organisation_programme(uuid,text,text,text,text,boolean) to authenticated;
