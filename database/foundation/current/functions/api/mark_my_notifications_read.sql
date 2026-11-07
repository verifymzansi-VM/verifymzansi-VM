-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.mark_my_notifications_read(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.mark_my_notifications_read(p_ids);
$function$;
alter function api.mark_my_notifications_read(uuid[]) owner to postgres;
revoke all on function api.mark_my_notifications_read(uuid[]) from public;
grant execute on function api.mark_my_notifications_read(uuid[]) to authenticated;
