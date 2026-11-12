-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_payment_problem(p_payment_id uuid, p_reason text, p_source text, p_alert boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_payment_problem(p_payment_id, p_reason, p_source, p_alert);
$function$;
alter function api.record_payment_problem(uuid,text,text,boolean) owner to postgres;
revoke all on function api.record_payment_problem(uuid,text,text,boolean) from public;
grant execute on function api.record_payment_problem(uuid,text,text,boolean) to service_role;
