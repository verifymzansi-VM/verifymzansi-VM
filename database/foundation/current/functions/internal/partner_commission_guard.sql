-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.partner_commission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.partner_id,new.payment_id,new.referred_account_id,new.base_cents,new.rate_bps,new.amount_cents,
      new.eligible_at,new.created_at) is distinct from (old.id,old.partner_id,old.payment_id,old.referred_account_id,
      old.base_cents,old.rate_bps,old.amount_cents,old.eligible_at,old.created_at)
    or old.status='reversed'
    or (old.status,new.status) not in(('pending','pending'),('pending','approved'),('pending','reversed'),
      ('approved','approved'),('approved','paid'),('approved','reversed'),('paid','paid'),('paid','reversed')) then
    raise exception 'commission history is immutable' using errcode='23514'; end if;
  return new;
end;
$function$;
alter function internal.partner_commission_guard() owner to postgres;
revoke all on function internal.partner_commission_guard() from public;
