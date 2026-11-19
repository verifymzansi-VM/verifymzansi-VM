-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_transfer_expired(t private.invoice_transfers)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select t.status = 'expired' or (t.status = 'awaiting_confirmation'
    and t.recorded_at <= statement_timestamp() - internal.invoice_transfer_expires_after());
$function$;
alter function internal.invoice_transfer_expired(private.invoice_transfers) owner to postgres;
revoke all on function internal.invoice_transfer_expired(private.invoice_transfers) from public;
