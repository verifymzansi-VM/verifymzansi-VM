-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_transfer_credit_expired(p_reference_key text, p_amount_cents bigint, p_cleared_on date, p_account_id uuid, p_invoice_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.invoice_transfers t
    where upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = p_reference_key
      and t.amount_received_cents = p_amount_cents and t.cleared_on = p_cleared_on
      and t.account_id = p_account_id
      and (t.customer_invoice_id is null or t.customer_invoice_id = p_invoice_id)
      and t.resolved_at is null
      and internal.invoice_transfer_expired(t));
$function$;
alter function internal.invoice_transfer_credit_expired(text,bigint,date,uuid,uuid) owner to postgres;
revoke all on function internal.invoice_transfer_credit_expired(text,bigint,date,uuid,uuid) from public;
