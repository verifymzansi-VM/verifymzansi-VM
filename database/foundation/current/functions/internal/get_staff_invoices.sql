-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_invoices()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  select jsonb_build_object('unpaid', (select count(*) from private.customer_invoices x where x.status = 'issued'),
      'items', coalesce(jsonb_agg(internal.customer_invoice_dto(i, actor) order by i.issued_at desc, i.id desc), '[]'::jsonb))
    into result
  from (select * from private.customer_invoices x order by x.issued_at desc, x.id desc limit 50) i;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_invoices() owner to postgres;
revoke all on function internal.get_staff_invoices() from public;
grant execute on function internal.get_staff_invoices() to authenticated;
