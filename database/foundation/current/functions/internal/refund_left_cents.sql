-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refund_left_cents(p_payment_id uuid, p_line_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- The payment's amount less what was refunded or charged back, waits for
  -- approval or is on its way through Ozow (internal.payment_refunded_before_cents);
  -- for one slot, also at most the slot's amount less the same for that slot.
  -- A slot reversed without a refund record of its own has nothing left.
  select greatest(least(
      p.amount_cents - internal.payment_refunded_before_cents(p.id),
      case when p_line_id is null then p.amount_cents
        else (select case when l.status = 'reversed' and not exists(select 1 from private.payment_refund_requests r
              where r.payment_line_id = l.id and r.status in ('applied', 'awaiting_approval', 'approved', 'sent'))
            then 0
            else l.amount_cents - coalesce((select sum(r.amount_cents) from private.payment_refund_requests r
              where r.payment_line_id = l.id and r.status in ('applied', 'awaiting_approval', 'approved', 'sent')), 0) end
          from private.payment_lines l where l.id = p_line_id and l.payment_id = p.id) end), 0)::bigint
  from private.payments p where p.id = p_payment_id;
$function$;
alter function internal.refund_left_cents(uuid,uuid) owner to postgres;
revoke all on function internal.refund_left_cents(uuid,uuid) from public;
