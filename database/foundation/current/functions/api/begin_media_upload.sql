-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.begin_media_upload(p_kind text, p_bytes integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.begin_media_upload(p_kind, p_bytes);
$function$;
alter function api.begin_media_upload(text,integer) owner to postgres;
revoke all on function api.begin_media_upload(text,integer) from public;
grant execute on function api.begin_media_upload(text,integer) to authenticated;
