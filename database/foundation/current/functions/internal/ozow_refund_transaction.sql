-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.ozow_refund_transaction(p_payment_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select lower(p.provider_transaction_id)::uuid from private.payments p
  where p.id = p_payment_id and p.provider = 'ozow'
    and p.provider_transaction_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$function$;
alter function internal.ozow_refund_transaction(uuid) owner to postgres;
revoke all on function internal.ozow_refund_transaction(uuid) from public;
