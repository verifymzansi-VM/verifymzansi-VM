-- Reviewed rollback for updates/20261111212320_payment_start_retry.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Revert (and deploy) the website
-- release that uses the update first: this rollback removes the command its
-- payment status job calls, api.expire_stale_checkouts. The website release
-- before it does not use it and passes the deploy preflight with or without
-- the update.
-- The rollback restores internal.claim_checkout_request byte for byte. Payments
-- the sweep already marked expired stay expired (they never had an Ozow
-- request, so no money was taken), and keys and expiry times already given to
-- leases stay as they are.
begin;
set local lock_timeout='5s';

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.claim_checkout_request(uuid,uuid)')) is distinct from 'd29afcd49f72e712602914d6ecb4d8f5'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.expire_stale_checkouts(integer)')) is distinct from '10861cf1c5a94cf00d6358216321ae4e'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.expire_stale_checkouts(integer)')) is distinct from '463872f511505e0b3ba84e0781814af0' then
    raise exception 'rollback precondition: the payment start retry update is not applied' using errcode='55000';
  end if;
end$$;

drop function api.expire_stale_checkouts(integer);
drop function internal.expire_stale_checkouts(integer);

-- The checkout lease as it was before the update.
CREATE OR REPLACE FUNCTION internal.claim_checkout_request(p_payment_id uuid, p_owner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments;
begin
  perform internal.payment_invoice_config();
  select * into pay from private.payments where id=p_payment_id and owner_id=p_owner_id for update;
  if not found or pay.status<>'pending' or not exists(select 1 from private.current_account_access a where a.id=p_owner_id) then
    raise exception 'pending checkout unavailable' using errcode='PT409'; end if;
  if pay.checkout_url is null and pay.checkout_claim_until>clock_timestamp() then
    raise exception 'checkout is being created' using errcode='PT409'; end if;
  if pay.checkout_url is null then
    update private.payments set checkout_claim_token=pg_catalog.gen_random_uuid(),
      checkout_claim_until=clock_timestamp()+interval '2 minutes',
      checkout_expires_at=coalesce(checkout_expires_at,clock_timestamp()+interval '30 minutes')
      where id=pay.id returning * into pay;
  end if;
  return internal.billing_payment_dto(pay)||jsonb_build_object('claim_token',pay.checkout_claim_token,
    'idempotency_key',pay.provider_idempotency_key,'correlation_id',pay.provider_correlation_id);
end;
$function$;
alter function internal.claim_checkout_request(uuid,uuid) owner to postgres;
revoke all on function internal.claim_checkout_request(uuid,uuid) from public;
grant execute on function internal.claim_checkout_request(uuid,uuid) to service_role;
commit;
