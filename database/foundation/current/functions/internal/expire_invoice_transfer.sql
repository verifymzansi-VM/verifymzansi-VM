-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.expire_invoice_transfer(p_transfer_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  update private.invoice_transfers t set status = 'expired', expired_at = statement_timestamp()
    where t.id = p_transfer_id and t.status = 'awaiting_confirmation'
      and t.recorded_at <= statement_timestamp() - internal.invoice_transfer_expires_after();
  return found;
end;
$function$;
alter function internal.expire_invoice_transfer(uuid) owner to postgres;
revoke all on function internal.expire_invoice_transfer(uuid) from public;
