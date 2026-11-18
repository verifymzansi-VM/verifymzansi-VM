-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refund_renewal_waiting(p_payment_id uuid, p_line_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- A renewal of a slot this refund would end is bought and has not started:
  -- refunding this period first would leave the slot without days until the
  -- renewal starts. p_line_id null: any slot of the payment.
  select exists(select 1 from private.entitlements e
    join private.entitlements r on r.renews_entitlement_id = e.id
    where e.payment_id = p_payment_id and (p_line_id is null or e.payment_line_id = p_line_id)
      and r.status <> 'revoked' and r.starts_at > statement_timestamp());
$function$;
alter function internal.refund_renewal_waiting(uuid,uuid) owner to postgres;
revoke all on function internal.refund_renewal_waiting(uuid,uuid) from public;
