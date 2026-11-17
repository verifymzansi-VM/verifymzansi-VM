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
  select jsonb_build_object('items', coalesce(jsonb_agg(internal.invoice_transfer_dto(t, actor)
      || jsonb_build_object('expired_at', t.expired_at, 'invoice_number',
        (select i.invoice_number from private.customer_invoices i where i.id = t.customer_invoice_id))
      order by t.expired_at desc, t.id desc), '[]'::jsonb))
    into result
  from (select * from private.invoice_transfers x where x.status = 'expired'
      and x.expired_at > statement_timestamp() - interval '30 days'
    order by x.expired_at desc, x.id desc limit 20) t;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_expired_invoice_transfers() owner to postgres;
revoke all on function internal.get_staff_expired_invoice_transfers() from public;
grant execute on function internal.get_staff_expired_invoice_transfers() to authenticated;
