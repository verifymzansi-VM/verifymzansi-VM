-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.public_programme_showcases(p_placement text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.public_programme_showcases(p_placement);
$function$;
alter function api.public_programme_showcases(text) owner to postgres;
revoke all on function api.public_programme_showcases(text) from public;
grant execute on function api.public_programme_showcases(text) to anon;
grant execute on function api.public_programme_showcases(text) to authenticated;
