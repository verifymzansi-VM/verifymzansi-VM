-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_my_frontend_posts(p_kind text, p_area text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.list_my_frontend_posts(p_kind,p_area,p_limit,p_offset)$function$;
alter function api.list_my_frontend_posts(text,text,integer,integer) owner to postgres;
revoke all on function api.list_my_frontend_posts(text,text,integer,integer) from public;
grant execute on function api.list_my_frontend_posts(text,text,integer,integer) to authenticated;
