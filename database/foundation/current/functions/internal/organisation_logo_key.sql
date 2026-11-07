-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.organisation_logo_key(o private.organisations)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select m.object_key from private.media_objects m
  where m.id=o.logo_object_id and o.logo_permission_at is not null and m.state='ready' and m.kind='image';
$function$;
alter function internal.organisation_logo_key(private.organisations) owner to postgres;
revoke all on function internal.organisation_logo_key(private.organisations) from public;
