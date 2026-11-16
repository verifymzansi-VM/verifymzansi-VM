-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.ozow_transaction_payment(p_transaction uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p.id from private.payments p
  where p.provider = 'ozow' and lower(p.provider_transaction_id) = p_transaction::text;
$function$;
alter function internal.ozow_transaction_payment(uuid) owner to postgres;
revoke all on function internal.ozow_transaction_payment(uuid) from public;
