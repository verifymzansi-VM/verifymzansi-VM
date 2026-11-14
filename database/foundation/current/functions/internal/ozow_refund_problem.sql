-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.ozow_refund_problem(p_payment_id uuid, p_reason text, p_source text, p_key text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select null::void from internal.record_payment_problem(p_payment_id, p_reason, p_source, true, p_key);
$function$;
alter function internal.ozow_refund_problem(uuid,text,text,text) owner to postgres;
revoke all on function internal.ozow_refund_problem(uuid,text,text,text) from public;
