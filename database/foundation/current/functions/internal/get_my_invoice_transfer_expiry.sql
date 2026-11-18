-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_invoice_transfer_expiry(p_invoice_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; latest private.invoice_transfers;
begin
  select * into inv from private.customer_invoices i
    where i.invoice_number = internal.customer_invoice_number(p_invoice_number) and i.account_id = actor;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  if inv.status = 'issued' then
    select * into latest from private.invoice_transfers t where t.customer_invoice_id = inv.id
      order by t.recorded_at desc, t.id desc limit 1;
  end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('invoice_number', inv.invoice_number,
    'transfer_expired_at', case when latest.id is not null and internal.invoice_transfer_expired(latest)
      then coalesce(latest.expired_at, latest.recorded_at + internal.invoice_transfer_expires_after()) end);
end;
$function$;
alter function internal.get_my_invoice_transfer_expiry(text) owner to postgres;
revoke all on function internal.get_my_invoice_transfer_expiry(text) from public;
grant execute on function internal.get_my_invoice_transfer_expiry(text) to authenticated;
