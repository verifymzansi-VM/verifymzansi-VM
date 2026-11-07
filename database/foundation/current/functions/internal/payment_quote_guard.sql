-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_quote_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.owner_id,new.product_kind,new.plan_version_id,new.addon_version_id,
      new.target_post_id,new.amount_cents,new.currency,new.snapshot,new.merchant_reference,new.provider)
    is distinct from (old.id,old.owner_id,old.product_kind,old.plan_version_id,old.addon_version_id,
      old.target_post_id,old.amount_cents,old.currency,old.snapshot,old.merchant_reference,old.provider) then
    raise exception 'payment quote and historical target are immutable' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_quote_guard() owner to postgres;
revoke all on function internal.payment_quote_guard() from public;
