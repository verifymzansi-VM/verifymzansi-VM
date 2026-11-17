-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_my_frontend_profile(p_expected_revision integer, p_display_name text DEFAULT NULL::text, p_bio text DEFAULT NULL::text, p_province text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_restored_profile(p_expected_revision,p_display_name,p_bio,p_province,p_city);
$function$;
alter function api.save_my_frontend_profile(integer,text,text,text,text) owner to postgres;
revoke all on function api.save_my_frontend_profile(integer,text,text,text,text) from public;
grant execute on function api.save_my_frontend_profile(integer,text,text,text,text) to authenticated;
