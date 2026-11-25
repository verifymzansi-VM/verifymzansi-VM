-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_lost_days_preview(p_email text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_lost_days_preview(p_email);
$function$;
alter function api.get_lost_days_preview(text) owner to postgres;
revoke all on function api.get_lost_days_preview(text) from public;
grant execute on function api.get_lost_days_preview(text) to authenticated;
