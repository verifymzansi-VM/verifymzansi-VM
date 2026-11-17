-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_expired_invoice_transfers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  with open as (
    select t as transfer, t.id, coalesce(t.expired_at, t.recorded_at + internal.invoice_transfer_expires_after()) as expired_on
    from private.invoice_transfers t
    where internal.invoice_transfer_follow_up_open(t)
  )
  select jsonb_build_object('unresolved', (select count(*) from open),
      'items', coalesce((select jsonb_agg(internal.invoice_transfer_dto(o.transfer, actor)
        || jsonb_build_object('status', 'expired', 'expired_at', o.expired_on, 'invoice_number',
          (select i.invoice_number from private.customer_invoices i where i.id = (o.transfer).customer_invoice_id))
        order by o.expired_on, o.id)
      from (select * from open order by expired_on, id limit 200) o), '[]'::jsonb))
    into result;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_expired_invoice_transfers() owner to postgres;
revoke all on function internal.get_staff_expired_invoice_transfers() from public;
grant execute on function internal.get_staff_expired_invoice_transfers() to authenticated;
