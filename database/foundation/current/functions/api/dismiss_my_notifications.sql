-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.dismiss_my_notifications(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$ select internal.dismiss_my_notifications(p_ids); $function$;
alter function api.dismiss_my_notifications(uuid[]) owner to postgres;
revoke all on function api.dismiss_my_notifications(uuid[]) from public;
grant execute on function api.dismiss_my_notifications(uuid[]) to authenticated;
