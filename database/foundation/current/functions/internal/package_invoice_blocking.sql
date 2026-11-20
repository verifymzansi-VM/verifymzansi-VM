-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.package_invoice_blocking(p_account uuid, p_payment uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select i.invoice_number from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
  where i.account_id = p_account and i.status = 'issued' and internal.slot_package_plan(v.plan_code)
    and not exists(select 1 from private.customer_invoice_payments l where l.invoice_id = i.id and l.payment_id = p_payment)
    and not exists(select 1 from private.package_invoice_requests r where r.invoice_id = i.id and r.kind = 'add'
      and not exists(select 1 from private.entitlements e where e.package_id = r.package_id and e.status = 'active'
        and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp()))
  order by i.issued_at, i.id
  limit 1;
$function$;
alter function internal.package_invoice_blocking(uuid,uuid) owner to postgres;
revoke all on function internal.package_invoice_blocking(uuid,uuid) from public;
