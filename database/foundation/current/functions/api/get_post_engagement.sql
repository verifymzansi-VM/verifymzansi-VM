-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_post_engagement(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_post_engagement(p_post_ids);
$function$;
alter function api.get_post_engagement(uuid[]) owner to postgres;
revoke all on function api.get_post_engagement(uuid[]) from public;
grant execute on function api.get_post_engagement(uuid[]) to anon;
grant execute on function api.get_post_engagement(uuid[]) to authenticated;
