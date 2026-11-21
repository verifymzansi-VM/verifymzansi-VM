-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_net_cents(p private.payments)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- What the payment brought in: nothing once the whole payment was refunded
  -- or charged back, else its amount less its reversed slots.
  select case when p.status in ('refunded', 'chargeback') then 0::bigint
    else greatest(p.amount_cents - coalesce((select sum(l.amount_cents) from private.payment_lines l
      where l.payment_id = p.id and l.status = 'reversed'), 0), 0)::bigint end;
$function$;
alter function internal.payment_net_cents(private.payments) owner to postgres;
revoke all on function internal.payment_net_cents(private.payments) from public;
