-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refund_renewal_not_started(p_payment_id uuid, p_line_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Every slot this refund covers is a renewal whose days have not started
  -- (the reason 'renewal_cancelled_before_start'). p_line_id null: the whole
  -- payment, as for a payment of one renewed slot.
  select coalesce((select bool_and(e.renews_entitlement_id is not null and e.starts_at > statement_timestamp())
    from private.entitlements e
    where e.payment_id = p_payment_id and (p_line_id is null or e.payment_line_id = p_line_id)), false);
$function$;
alter function internal.refund_renewal_not_started(uuid,uuid) owner to postgres;
revoke all on function internal.refund_renewal_not_started(uuid,uuid) from public;
