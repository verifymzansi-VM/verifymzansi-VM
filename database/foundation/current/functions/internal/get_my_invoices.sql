-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_invoices()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object('invoice_number', i.invoice_number,
      'status', i.status, 'issued_at', i.issued_at, 'due_on', to_char(i.due_on::timestamp, 'YYYY-MM-DD'),
      'description', i.description, 'total_cents', i.total_cents, 'paid_at', i.paid_at,
      'payment_status', (select p.status from private.payments p where p.id = i.payment_id))
      order by i.issued_at desc, i.id desc), '[]'::jsonb))
    into result
  from (select * from private.customer_invoices x where x.account_id = actor
    order by x.issued_at desc, x.id desc limit 100) i;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_invoices() owner to postgres;
revoke all on function internal.get_my_invoices() from public;
grant execute on function internal.get_my_invoices() to authenticated;
