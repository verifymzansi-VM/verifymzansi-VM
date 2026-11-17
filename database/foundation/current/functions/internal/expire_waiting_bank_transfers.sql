-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.expire_waiting_bank_transfers(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare expired integer; invoices integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'limit 1 to 1000' using errcode='22023';
  end if;
  with due as (
    select t.id from private.invoice_transfers t
    where t.status = 'awaiting_confirmation'
      and t.recorded_at <= statement_timestamp() - internal.invoice_transfer_expires_after()
    order by t.recorded_at, t.id
    limit p_limit
    for update skip locked
  ), done as (
    update private.invoice_transfers t set status = 'expired', expired_at = statement_timestamp()
    from due where t.id = due.id
    returning t.customer_invoice_id
  )
  select count(*), count(done.customer_invoice_id) into expired, invoices from done;
  return jsonb_build_object('expired', expired, 'invoices_open_again', invoices);
end;
$function$;
alter function internal.expire_waiting_bank_transfers(integer) owner to postgres;
revoke all on function internal.expire_waiting_bank_transfers(integer) from public;
grant execute on function internal.expire_waiting_bank_transfers(integer) to service_role;
