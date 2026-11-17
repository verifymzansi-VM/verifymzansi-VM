-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.resolve_my_frontend_media(p_keys text[] DEFAULT NULL::text[], p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.resolve_my_frontend_media(p_keys,p_ids)$function$;
alter function api.resolve_my_frontend_media(text[],uuid[]) owner to postgres;
revoke all on function api.resolve_my_frontend_media(text[],uuid[]) from public;
grant execute on function api.resolve_my_frontend_media(text[],uuid[]) to authenticated;
