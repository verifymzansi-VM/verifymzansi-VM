-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.add_lost_days(p_email text, p_days integer, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.add_lost_days(p_email, p_days, p_reason, p_request_id);
$function$;
alter function api.add_lost_days(text,integer,text,uuid) owner to postgres;
revoke all on function api.add_lost_days(text,integer,text,uuid) from public;
grant execute on function api.add_lost_days(text,integer,text,uuid) to authenticated;
