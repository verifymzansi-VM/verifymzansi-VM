-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.create_organisation(p_slug text, p_name text, p_type text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.create_organisation(p_slug,p_name,p_type,p_reason);
$function$;
alter function api.create_organisation(text,text,text,text) owner to postgres;
revoke all on function api.create_organisation(text,text,text,text) from public;
grant execute on function api.create_organisation(text,text,text,text) to authenticated;
