-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_my_frontend_notifications(p_limit integer DEFAULT 25, p_unread boolean DEFAULT false, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$ select internal.list_my_frontend_notifications(p_limit,p_unread,p_before); $function$;
alter function api.list_my_frontend_notifications(integer,boolean,timestamp with time zone) owner to postgres;
revoke all on function api.list_my_frontend_notifications(integer,boolean,timestamp with time zone) from public;
grant execute on function api.list_my_frontend_notifications(integer,boolean,timestamp with time zone) to authenticated;
