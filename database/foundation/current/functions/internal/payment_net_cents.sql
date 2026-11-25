-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_net_cents(p private.payments)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- What the payment brought in: its amount less the refunds and chargebacks
  -- applied to it, and less its reversed slots that no applied refund record
  -- covers. Nothing once the whole payment was refunded or charged back
  -- without a record of that kind (for example a bank's chargeback notice).
  select case when p.status in ('refunded', 'chargeback') and not exists(select 1 from private.payment_refund_requests r
      where r.payment_id = p.id and r.status = 'applied' and r.kind = p.status) then 0::bigint
    else greatest(p.amount_cents
      - coalesce((select sum(r.amount_cents) from private.payment_refund_requests r
        where r.payment_id = p.id and r.status = 'applied'), 0)
      - coalesce((select sum(l.amount_cents) from private.payment_lines l
        where l.payment_id = p.id and l.status = 'reversed'
          and not exists(select 1 from private.payment_refund_requests r where r.payment_id = p.id
            and r.status = 'applied' and r.ends_paid_days and (r.payment_line_id = l.id or r.payment_line_id is null))), 0),
      0)::bigint end;
$function$;
alter function internal.payment_net_cents(private.payments) owner to postgres;
revoke all on function internal.payment_net_cents(private.payments) from public;
