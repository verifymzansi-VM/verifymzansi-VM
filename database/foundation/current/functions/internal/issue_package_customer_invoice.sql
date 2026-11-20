-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.issue_package_customer_invoice(r private.package_invoice_requests, p_plan private.plan_versions, p_issuer uuid, p_due_days integer, p_reason text)
 RETURNS private.customer_invoices
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare issued_on date; year_number integer; next_number integer; made private.customer_invoices;
  q record; days integer; unit bigint; due date;
begin
  issued_on := internal.customer_invoice_day(statement_timestamp());
  year_number := extract(year from issued_on)::integer;
  unit := p_plan.price_cents;
  due := issued_on + p_due_days;
  if r.kind = 'add' then
    -- 20261120045404: added slots at the price asked for (D1); when fewer
    -- whole days are left now than it was priced for, for those days at
    -- their lower price (slots × unit price = total, as always). Due 3 days
    -- after it is issued, or on the package's last day (South African date)
    -- when that is sooner; the days staff give are not used for an add.
    select x.* into q from internal.slot_package_add_quote(r.account_id) x where x.package_id = r.package_id;
    days := least(r.days_left, q.days_left);
    unit := case when days < r.days_left
      then round(p_plan.price_cents::numeric * days / p_plan.duration_days)::bigint
      else r.unit_price_cents end;
    due := least(issued_on + 3, internal.customer_invoice_day(q.ends_at));
  end if;
  insert into private.customer_invoice_numbers as n (invoice_year, last_number) values (year_number, 1)
    on conflict (invoice_year) do update set last_number = n.last_number + 1
    returning n.last_number into next_number;
  insert into private.customer_invoices (invoice_number, invoice_year, sequence_number, account_id, plan_version_id,
      slots, unit_price_cents, total_cents, description, due_on, issued_by, issue_reason, request_id, seller)
    values ('VM-' || year_number::text || '-' || lpad(next_number::text, 6, '0'), year_number, next_number, r.account_id,
      p_plan.id, r.slots, unit, unit * r.slots,
      case when r.kind = 'add'
        then 'Multi-listing package: ' || r.slots::text || case when r.slots = 1 then ' slot' else ' slots' end
          || ' added for ' || days::text || ' days'
        else 'Multi-listing package: ' || r.slots::text || ' slots × ' || p_plan.duration_days::text || ' days' end,
      due, p_issuer, p_reason, r.id,
      jsonb_build_object('legal_name', 'Verifymzansi (Pty) Ltd', 'registration_number', '2026/155305/07',
        'vat_registered', false))
    returning * into made;
  return made;
end;
$function$;
alter function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) owner to postgres;
revoke all on function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) from public;
