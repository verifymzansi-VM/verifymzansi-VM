-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.finalize_media(p_object_id uuid, p_size integer, p_sha256 text, p_mime text, p_width integer DEFAULT NULL::integer, p_height integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.finalize_media(p_object_id, p_size, p_sha256, p_mime, p_width, p_height);
$function$;
alter function api.finalize_media(uuid,integer,text,text,integer,integer) owner to postgres;
revoke all on function api.finalize_media(uuid,integer,text,text,integer,integer) from public;
grant execute on function api.finalize_media(uuid,integer,text,text,integer,integer) to service_role;
