-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.ozow_refund_window_open(p_payment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Counted from the payment's created_at (the start of the Ozow transaction).
  select coalesce((select statement_timestamp() < p.created_at + internal.ozow_refund_window()
    from private.payments p where p.id = p_payment_id), false);
$function$;
alter function internal.ozow_refund_window_open(uuid) owner to postgres;
revoke all on function internal.ozow_refund_window_open(uuid) from public;
