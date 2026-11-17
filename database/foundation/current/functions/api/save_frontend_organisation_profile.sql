-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_frontend_organisation_profile(p_slug text, p_patch jsonb, p_reason text, p_id uuid DEFAULT NULL::uuid, p_expected integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_frontend_organisation_profile(p_slug,p_patch,p_reason,p_id,p_expected)
$function$;
alter function api.save_frontend_organisation_profile(text,jsonb,text,uuid,integer) owner to postgres;
revoke all on function api.save_frontend_organisation_profile(text,jsonb,text,uuid,integer) from public;
grant execute on function api.save_frontend_organisation_profile(text,jsonb,text,uuid,integer) to authenticated;
