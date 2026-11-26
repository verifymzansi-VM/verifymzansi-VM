-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_refunded_before_cents(p_payment_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Refunds applied, waiting or on their way through Ozow, plus reversed slots
  -- no applied refund record that ended the paid days covers: a part refund
  -- that kept the slot running does not cover a later reversal of it
  -- (20261125194727_part_refund_follow_ups.sql).
  select coalesce((select sum(r.amount_cents) from private.payment_refund_requests r
      where r.payment_id = p_payment_id and r.status in ('applied', 'awaiting_approval', 'approved', 'sent')), 0)
    + coalesce((select sum(l.amount_cents) from private.payment_lines l
      where l.payment_id = p_payment_id and l.status = 'reversed'
        and not exists(select 1 from private.payment_refund_requests r
          where r.status = 'applied' and r.ends_paid_days and r.payment_id = p_payment_id
            and (r.payment_line_id = l.id or r.payment_line_id is null))), 0)::bigint;
$function$;
alter function internal.payment_refunded_before_cents(uuid) owner to postgres;
revoke all on function internal.payment_refunded_before_cents(uuid) from public;
