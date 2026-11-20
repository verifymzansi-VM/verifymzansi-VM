-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.void_ended_package_add_invoices(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare r record; voided integer := 0; skipped integer := 0; n integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit must be 1 to 500' using errcode='22023';
  end if;
  for r in
    select i.id from private.customer_invoices i join private.package_invoice_requests q on q.invoice_id = i.id
    where i.status = 'issued' and q.kind = 'add'
      and not exists(select 1 from private.entitlements e where e.package_id = q.package_id and e.status = 'active'
        and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp())
      and not exists(select 1 from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
        where l.invoice_id = i.id and internal.customer_invoice_attempt_live(p))
      and not exists(select 1 from private.invoice_transfers t where t.customer_invoice_id = i.id
        and internal.invoice_transfer_waiting(t))
    order by i.issued_at, i.id
    limit p_limit
  loop
    begin
      update private.payments p set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
        from private.customer_invoice_payments l
        where l.invoice_id = r.id and l.payment_id = p.id and p.status = 'pending' and p.checkout_url is null;
      update private.customer_invoices set status = 'void', voided_at = statement_timestamp(),
          void_reason = 'The package these slots were added to ended before the invoice was paid'
        where id = (select i.id from private.customer_invoices i where i.id = r.id and i.status = 'issued'
          for update skip locked);
      get diagnostics n = row_count;
      if n = 0 then skipped := skipped + 1; else voided := voided + 1; end if;
    exception when others then
      skipped := skipped + 1;
    end;
  end loop;
  return jsonb_build_object('voided', voided, 'failed', skipped);
end;
$function$;
alter function internal.void_ended_package_add_invoices(integer) owner to postgres;
revoke all on function internal.void_ended_package_add_invoices(integer) from public;
grant execute on function internal.void_ended_package_add_invoices(integer) to service_role;
