-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_frontend_support_inbox(p_page integer DEFAULT 1, p_ticket uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.get_frontend_support_inbox(p_page,p_ticket)$function$;
alter function api.get_frontend_support_inbox(integer,uuid) owner to postgres;
revoke all on function api.get_frontend_support_inbox(integer,uuid) from public;
grant execute on function api.get_frontend_support_inbox(integer,uuid) to authenticated;
