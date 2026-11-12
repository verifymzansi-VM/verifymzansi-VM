-- A failed attempt to open the payment page never blocks a member.
--
-- A plan or add-on checkout is one pending payment per member and product.
-- The website asks the database for a short lease on it
-- (internal.claim_checkout_request), asks Ozow for a payment request with the
-- payment's stored expiry time and idempotency key, and attaches the request
-- Ozow returns. Until now the expiry time was set once, at the first lease, and
-- the idempotency key never changed. When the first call to Ozow failed, no
-- request was attached, the payment stayed pending, and every later attempt
-- reused it with the same key and an expiry time that had passed after 30
-- minutes. Nothing ever closed such a payment, so the member could not buy
-- that product again.
--
-- From this update:
-- 1. internal.claim_checkout_request (same arguments, result and grants): a
--    new lease on a pending payment with no Ozow request always gives a fresh
--    30-minute expiry. When an earlier lease was taken (an earlier attempt may
--    have reached Ozow), the lease also gets a new idempotency key, so Ozow
--    never sees a key it already answered with a different expiry. The member
--    never received an earlier request's page (the website returns a page only
--    after attaching its request), so nobody can pay an abandoned request; a
--    payment's notices and status checks match only the request attached to
--    it. The first lease keeps the key the payment was created with, and a
--    payment that already has a request is returned unchanged, as before.
-- 2. New service command api.expire_stale_checkouts(p_limit): marks expired
--    the pending payments that have no Ozow request, were created more than an
--    hour ago and are not leased right now, oldest first, at most p_limit
--    (1-500) per call, and returns how many. It skips rows another transaction
--    holds, never touches a payment with a request (the status check handles
--    those), and a repeated call changes nothing more. The website's payment
--    status job (/api/internal/payments/reconcile, run every 10 minutes by the
--    payment-cleanup Worker) calls it before checking payments with Ozow, so
--    such a payment is closed within about 70 minutes and the member's next
--    checkout creates a new one.
-- No existing API command changes signature, grant or owner, so the website
-- deployed before this update keeps working with it and can be redeployed.
--
-- ORDER: apply this update BEFORE the website release that uses it (the pull
-- request that adds this file) is deployed: that release's payment status job
-- calls api.expire_stale_checkouts and reports a failure until it exists.
-- Read-only preflight:
-- ../preflight/20261111212320_payment_start_retry.check.sql.
-- Rollback: ../rollback/20261111212320_payment_start_retry.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: the checkout lease is the reviewed body (or already this
-- update's).
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.claim_checkout_request(uuid,uuid)'))
      is null
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.claim_checkout_request(uuid,uuid)'))
      not in('beae8fd49a3fabe4d4f80264ab4e09b4','d29afcd49f72e712602914d6ecb4d8f5') then
    raise exception 'checkout lease drift: internal.claim_checkout_request is not the reviewed body' using errcode='55000';
  end if;
end$$;

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
    -- No request is attached, so every earlier attempt ended before Ozow's
    -- page reached the member. Each attempt gets a fresh 30-minute window;
    -- after an earlier lease, also a new idempotency key (Ozow must not see a
    -- key it already answered with another expiry).
    update private.payments set checkout_claim_token=pg_catalog.gen_random_uuid(),
      checkout_claim_until=clock_timestamp()+interval '2 minutes',
      checkout_expires_at=clock_timestamp()+interval '30 minutes',
      provider_idempotency_key=case when checkout_claim_token is null then provider_idempotency_key
        else pg_catalog.gen_random_uuid() end
      where id=pay.id returning * into pay;
  end if;
  return internal.billing_payment_dto(pay)||jsonb_build_object('claim_token',pay.checkout_claim_token,
    'idempotency_key',pay.provider_idempotency_key,'correlation_id',pay.provider_correlation_id);
end;
$function$;
alter function internal.claim_checkout_request(uuid,uuid) owner to postgres;
revoke all on function internal.claim_checkout_request(uuid,uuid) from public;
grant execute on function internal.claim_checkout_request(uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION internal.expire_stale_checkouts(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare expired integer;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid checkout sweep limit' using errcode='22023'; end if;
  -- Pending for over an hour, no Ozow request, no lease running: no attempt
  -- can still attach a request to it. Rows another transaction holds are
  -- left for the next run.
  with stale as (
    select p.id from private.payments p
    where p.status='pending' and p.provider_request_id is null and p.checkout_url is null
      and p.created_at<clock_timestamp()-interval '1 hour'
      and (p.checkout_claim_until is null or p.checkout_claim_until<=clock_timestamp())
    order by p.created_at, p.id
    limit p_limit
    for update skip locked)
  update private.payments p set status='expired',status_changed_at=clock_timestamp()
    from stale
    where p.id=stale.id and p.status='pending' and p.provider_request_id is null and p.checkout_url is null
      and (p.checkout_claim_until is null or p.checkout_claim_until<=clock_timestamp());
  get diagnostics expired=row_count;
  return expired;
end;
$function$;
alter function internal.expire_stale_checkouts(integer) owner to postgres;
revoke all on function internal.expire_stale_checkouts(integer) from public,anon,authenticated,service_role;
grant execute on function internal.expire_stale_checkouts(integer) to service_role;

CREATE OR REPLACE FUNCTION api.expire_stale_checkouts(p_limit integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.expire_stale_checkouts(p_limit);
$function$;
alter function api.expire_stale_checkouts(integer) owner to postgres;
revoke all on function api.expire_stale_checkouts(integer) from public,anon,authenticated,service_role;
grant execute on function api.expire_stale_checkouts(integer) to service_role;
commit;
