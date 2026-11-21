-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.vat_sales_position()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Sales of the last 12 months against the VAT registration levels: an
  -- early alert at R1.8 million, compulsory registration at R2.3 million.
  with paid as (
    select internal.payment_net_cents(p) as net from private.payments p
    where p.status in ('complete', 'refunded', 'chargeback')
      and p.completed_at > statement_timestamp() - interval '12 months'
  ), totals as (
    select count(*) as payments, coalesce(sum(net), 0)::bigint as net_cents from paid
  ), setting as (
    select coalesce((select c.registration_status from private.invoice_merchant_config c where c.singleton),
      'undecided') as vat_status
  )
  select jsonb_build_object('since', statement_timestamp() - interval '12 months',
    'payments', t.payments, 'net_cents', t.net_cents, 'vat_status', s.vat_status,
    'alert_cents', 180000000, 'compulsory_cents', 230000000,
    'alert', s.vat_status <> 'registered' and t.net_cents >= 180000000)
  from totals t, setting s;
$function$;
alter function internal.vat_sales_position() owner to postgres;
revoke all on function internal.vat_sales_position() from public;
