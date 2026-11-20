-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
  -- A Multi-listing package (20261114154823) reaches Ozow only while packages
  -- are on sale and the member's ID review is still accepted; and
  -- (20261119151152) never while the account has a package that has not
  -- ended, or a package invoice that is unpaid and that this payment is not
  -- an attempt of: a checkout started before that invoice was paid by bank
  -- transfer could otherwise be paid beside the package. The checks run under
  -- the account's package lock, which a bank transfer's confirmation, Pay now
  -- and a package delivery hold while they work, taken without waiting (this
  -- already holds the payment, which a delivery locks before that lock): while
  -- one of them runs, the member is asked to try again in a moment. These
  -- three apply only to a payment not sent to Ozow yet: one already open there
  -- keeps the member's choice to continue, check or cancel it.
  if exists(select 1 from private.plan_versions v where v.id=pay.plan_version_id
      and internal.slot_package_plan(v.plan_code)) then
    if pay.checkout_url is null and not pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended('slot-package:'||pay.owner_id::text, 707)) then
      raise exception 'your package is being updated; try again in a moment' using errcode='PT409', detail='package_busy';
    end if;
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if internal.current_verified_identity(pay.owner_id) is null then
      raise exception 'your ID review must be accepted before you buy a package' using errcode='PT412';
    end if;
    if pay.snapshot->>'category' = 'slot_package_add' then
      -- Slots added part-way (20261120120000): sent only for the running
      -- package they were priced for, with room. An online order holds its
      -- price 30 minutes and needs 7 or more whole days left; an invoice's
      -- Pay now keeps the invoice's price.
      if pay.checkout_url is null then
        if not internal.slot_package_add_ok(pay.owner_id, (pay.snapshot->>'package_id')::uuid,
            (pay.snapshot->>'slot_capacity')::integer) then
          raise exception 'the package these slots were for has ended' using errcode='PT409', detail='package_ended';
        end if;
        if pay.snapshot->>'customer_invoice_id' is null then
          if pay.created_at <= clock_timestamp() - interval '30 minutes' then
            raise exception 'the price of these slots was held for 30 minutes; start again'
              using errcode='PT409', detail='package_add_price_expired';
          end if;
          if coalesce((select q.days_left from internal.slot_package_add_quote(pay.owner_id) q), 0) < 7 then
            raise exception 'slots can be added while 7 or more days of the package are left'
              using errcode='PT409', detail='package_add_too_late';
          end if;
        end if;
      end if;
    elsif pay.checkout_url is null and internal.slot_package_open(pay.owner_id) then
      raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
    end if;
    if pay.checkout_url is null and exists(select 1 from private.customer_invoices i
        join private.plan_versions v on v.id=i.plan_version_id
        where i.account_id=pay.owner_id and i.status='issued' and internal.slot_package_plan(v.plan_code)
          and not exists(select 1 from private.customer_invoice_payments l where l.invoice_id=i.id and l.payment_id=pay.id)) then
      raise exception 'your package invoice is not paid yet; pay it, or ask us to cancel it first'
        using errcode='PT409', detail='package_invoice_unpaid';
    end if;
  end if;
  -- Final guard (20261117082020): a new Ozow request is never created above
  -- the most Ozow accepts in one payment; every checkout refuses first.
  if pay.checkout_url is null and pay.amount_cents > internal.online_payment_max_cents() then
    raise exception 'this payment is above the online payment limit of % cents', internal.online_payment_max_cents()
      using errcode='PT413', detail='online_payment_above_limit';
  end if;
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
