-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.extend_free_credit(p_credit_id uuid, p_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.extend_free_credit(p_credit_id, p_days, p_reason);
$function$;
alter function api.extend_free_credit(uuid,integer,text) owner to postgres;
revoke all on function api.extend_free_credit(uuid,integer,text) from public;
grant execute on function api.extend_free_credit(uuid,integer,text) to authenticated;
