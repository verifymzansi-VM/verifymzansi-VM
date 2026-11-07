-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reserve_frontend_media_upload(p_kind text, p_bytes integer, p_digest text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.reserve_frontend_media_upload(p_kind,p_bytes,p_digest)$function$;
alter function api.reserve_frontend_media_upload(text,integer,text) owner to postgres;
revoke all on function api.reserve_frontend_media_upload(text,integer,text) from public;
grant execute on function api.reserve_frontend_media_upload(text,integer,text) to authenticated;
