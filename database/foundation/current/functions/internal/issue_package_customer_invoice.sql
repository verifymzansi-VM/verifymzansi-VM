-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.issue_package_customer_invoice(r private.package_invoice_requests, p_plan private.plan_versions, p_issuer uuid, p_due_days integer, p_reason text)
 RETURNS private.customer_invoices
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare issued_on date; year_number integer; next_number integer; made private.customer_invoices;
begin
  issued_on := internal.customer_invoice_day(statement_timestamp());
  year_number := extract(year from issued_on)::integer;
  insert into private.customer_invoice_numbers as n (invoice_year, last_number) values (year_number, 1)
    on conflict (invoice_year) do update set last_number = n.last_number + 1
    returning n.last_number into next_number;
  insert into private.customer_invoices (invoice_number, invoice_year, sequence_number, account_id, plan_version_id,
      slots, unit_price_cents, total_cents, description, due_on, issued_by, issue_reason, request_id, seller)
    values ('VM-' || year_number::text || '-' || lpad(next_number::text, 6, '0'), year_number, next_number, r.account_id,
      p_plan.id, r.slots,
      -- 20261120045404: added slots at the price asked for (D1).
      case when r.kind = 'add' then r.unit_price_cents else p_plan.price_cents end,
      case when r.kind = 'add' then r.total_cents else p_plan.price_cents * r.slots end,
      case when r.kind = 'add'
        then 'Multi-listing package: ' || r.slots::text || case when r.slots = 1 then ' slot' else ' slots' end
          || ' added for ' || r.days_left::text || ' days'
        else 'Multi-listing package: ' || r.slots::text || ' slots × ' || p_plan.duration_days::text || ' days' end,
      issued_on + p_due_days, p_issuer, p_reason, r.id,
      jsonb_build_object('legal_name', 'Verifymzansi (Pty) Ltd', 'registration_number', '2026/155305/07',
        'vat_registered', false))
    returning * into made;
  return made;
end;
$function$;
alter function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) owner to postgres;
revoke all on function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) from public;
