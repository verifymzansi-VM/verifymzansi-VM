-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reserve_frontend_seen_photo(p_case uuid, p_digest text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_mime text DEFAULT 'image/jpeg'::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.reserve_frontend_seen_photo(p_case,p_digest,p_lat,p_lng,p_mime)$function$;
alter function api.reserve_frontend_seen_photo(uuid,text,numeric,numeric,text) owner to postgres;
revoke all on function api.reserve_frontend_seen_photo(uuid,text,numeric,numeric,text) from public;
grant execute on function api.reserve_frontend_seen_photo(uuid,text,numeric,numeric,text) to authenticated;
