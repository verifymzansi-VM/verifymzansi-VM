-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_public_organisation(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_public_organisation(p_slug);
$function$;
alter function api.get_public_organisation(text) owner to postgres;
revoke all on function api.get_public_organisation(text) from public;
grant execute on function api.get_public_organisation(text) to anon;
grant execute on function api.get_public_organisation(text) to authenticated;
