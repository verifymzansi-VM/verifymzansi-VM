-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.media_storage_allowance(p_owner uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select (2 * c.posts + 10)::bigint * c.post_media_bytes from internal.package_capacity(p_owner) c;
$function$;
alter function internal.media_storage_allowance(uuid) owner to postgres;
revoke all on function internal.media_storage_allowance(uuid) from public;
