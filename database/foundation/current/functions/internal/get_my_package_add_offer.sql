-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_package_add_offer()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); q record; request private.package_invoice_requests;
  result jsonb;
begin
  select x.* into q from internal.slot_package_add_quote(actor) x;
  if q.package_id is not null then
    select r.* into request from private.package_invoice_requests r
      where r.account_id = actor and r.kind = 'add' and r.package_id = q.package_id
      order by r.requested_at desc, r.id limit 1;
  end if;
  result := jsonb_build_object(
    'on_sale', internal.slot_packages_on_sale(),
    'verified', internal.current_verified_identity(actor) is not null,
    'online_limit_cents', internal.online_payment_max_cents()::text,
    'package', case when q.package_id is null then null else jsonb_build_object(
      'id', q.package_id, 'term_days', q.term_days, 'places', q.places, 'ends_at', q.ends_at,
      'days_left', q.days_left, 'unit_price_cents', q.unit_price_cents::text,
      'max_slots', greatest(250 - q.places, 0),
      'max_online_slots', greatest(100 - q.places, 0),
      'online_open', q.days_left >= 7 and q.plan_id is not null,
      'invoice_open', q.days_left >= 10 and q.plan_id is not null,
      'invoice_unpaid', exists(select 1 from private.customer_invoices i
        join private.plan_versions v on v.id = i.plan_version_id
        where i.account_id = actor and i.status = 'issued' and internal.slot_package_plan(v.plan_code)),
      'request', case when request.id is null then null
        else internal.package_invoice_request_dto(request, null) end,
      -- the slots added to it so far (paid and delivered), newest first
      'adds', coalesce((select jsonb_agg(jsonb_build_object('payment_id', x.id, 'slots', x.slots,
          'paid_at', x.completed_at) order by x.completed_at desc, x.id)
        from (select p.id, l.slot_count as slots, p.completed_at from private.payments p
            join private.payment_lines l on l.payment_id = p.id and l.line_number = 1
          where p.owner_id = actor and p.status = 'complete' and p.fulfillment_status = 'fulfilled'
            and p.snapshot->>'category' = 'slot_package_add' and p.snapshot->>'package_id' = q.package_id::text
          order by p.completed_at desc, p.id limit 20) x), '[]'::jsonb)) end);
  perform internal.price_draft_actor(); -- final live owner/session check
  return result;
end;
$function$;
alter function internal.get_my_package_add_offer() owner to postgres;
revoke all on function internal.get_my_package_add_offer() from public;
grant execute on function internal.get_my_package_add_offer() to authenticated;
