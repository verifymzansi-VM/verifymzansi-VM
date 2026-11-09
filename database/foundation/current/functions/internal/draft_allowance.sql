-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.draft_allowance(p_owner uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 5 + c.posts from internal.package_capacity(p_owner) c;
$function$;
alter function internal.draft_allowance(uuid) owner to postgres;
revoke all on function internal.draft_allowance(uuid) from public;
