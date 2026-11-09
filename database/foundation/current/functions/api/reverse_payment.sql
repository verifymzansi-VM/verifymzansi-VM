-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reverse_payment(p_payment_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reverse_payment(p_payment_id, p_kind, p_reason);
$function$;
alter function api.reverse_payment(uuid,text,text) owner to postgres;
revoke all on function api.reverse_payment(uuid,text,text) from public;
grant execute on function api.reverse_payment(uuid,text,text) to service_role;
