-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_my_posts(p_limit integer DEFAULT 48, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_my_posts(p_limit,p_offset);
$function$;
alter function api.list_my_posts(integer,integer) owner to postgres;
revoke all on function api.list_my_posts(integer,integer) from public;
grant execute on function api.list_my_posts(integer,integer) to authenticated;
