-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.person_name_reserved(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  select pg_catalog.translate(p_name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
    operator(pg_catalog.~) 'verify *mzansi|(^|[^a-z0-9_])(admin|administrator|moderator|support|staff|official)([^a-z0-9_]|$)';
$function$;
alter function internal.person_name_reserved(text) owner to postgres;
revoke all on function internal.person_name_reserved(text) from public;
