-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_frontend_privacy_queue(p_view text DEFAULT 'open'::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.get_frontend_privacy_queue(p_view,p_page)$function$;
alter function api.get_frontend_privacy_queue(text,integer) owner to postgres;
revoke all on function api.get_frontend_privacy_queue(text,integer) from public;
grant execute on function api.get_frontend_privacy_queue(text,integer) to authenticated;
