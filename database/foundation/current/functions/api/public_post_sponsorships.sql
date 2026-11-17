-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.public_post_sponsorships(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.public_post_sponsorships(p_post_ids);
$function$;
alter function api.public_post_sponsorships(uuid[]) owner to postgres;
revoke all on function api.public_post_sponsorships(uuid[]) from public;
grant execute on function api.public_post_sponsorships(uuid[]) to anon;
grant execute on function api.public_post_sponsorships(uuid[]) to authenticated;
