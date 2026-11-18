-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_transfer_follow_up_open(t private.invoice_transfers)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.invoice_transfer_expired(t) and t.resolved_at is null
    and not exists(select 1 from private.invoice_transfers x where x.id <> t.id and x.status = 'confirmed'
      and x.amount_received_cents = t.amount_received_cents and x.cleared_on = t.cleared_on
      and upper(regexp_replace(x.bank_reference, '[^A-Za-z0-9]', '', 'g'))
        = upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')));
$function$;
alter function internal.invoice_transfer_follow_up_open(private.invoice_transfers) owner to postgres;
revoke all on function internal.invoice_transfer_follow_up_open(private.invoice_transfers) from public;
