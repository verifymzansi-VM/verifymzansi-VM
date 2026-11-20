-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.package_invoice_issue_check(r private.package_invoice_requests)
 RETURNS private.plan_versions
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare plan private.plan_versions; unpaid text; q record;
begin
  if not exists(select 1 from private.current_account_access a where a.id = r.account_id) then
    raise exception 'the customer''s account cannot use slots now' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  if internal.current_verified_identity(r.account_id) is null then
    raise exception 'the customer''s ID review must be accepted before an invoice is issued'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  if r.kind = 'add' then
    -- Slots added part-way (20261120045404): at the price asked for (D1),
    -- only while the package runs with 7 or more whole days left and room.
    select * into plan from private.plan_versions v where v.id = r.plan_version_id
      and internal.slot_package_plan(v.plan_code);
    if not found then
      raise exception 'this package term is no longer sold; decline the request'
        using errcode='PT409', detail='invoice_plan_unavailable';
    end if;
    select x.* into q from internal.slot_package_add_quote(r.account_id) x;
    if q.package_id is distinct from r.package_id then
      raise exception 'the customer''s package has ended; decline the request'
        using errcode='PT409', detail='package_ended';
    end if;
    if q.days_left < 7 then
      raise exception 'fewer than 7 days of the customer''s package are left; decline the request'
        using errcode='PT409', detail='package_add_too_late';
    end if;
    if q.places + r.slots > 250 then
      raise exception 'the package would hold more than 250 slots; decline the request'
        using errcode='PT409', detail='package_slots_invalid';
    end if;
  else
    select * into plan from private.plan_versions v where v.id = r.plan_version_id and v.retired_at is null
      and internal.slot_package_plan(v.plan_code) and v.price_cents = r.unit_price_cents;
    if not found then
      raise exception 'this package term is no longer sold at the price asked for; decline the request'
        using errcode='PT409', detail='invoice_plan_unavailable';
    end if;
    if internal.slot_package_open(r.account_id) then
      raise exception 'the customer already has a Multi-listing package; decline the request'
        using errcode='PT409', detail='package_active';
    end if;
  end if;
  -- A package payment of the account open at Ozow could still be paid and
  -- open a package: it is finished or cancelled first.
  if exists(select 1 from private.payments p join private.plan_versions v on v.id = p.plan_version_id
      where p.owner_id = r.account_id and p.status = 'pending' and p.target_post_id is null
        and internal.slot_package_plan(v.plan_code)
        and (p.checkout_url is not null or p.checkout_claim_until > pg_catalog.clock_timestamp())) then
    raise exception 'the customer has a package payment open at Ozow; try again when it has closed'
      using errcode='PT409', detail='invoice_checkout_open';
  end if;
  select i.invoice_number into unpaid from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
    where i.account_id = r.account_id and i.status = 'issued' and internal.slot_package_plan(v.plan_code)
    order by i.issued_at limit 1;
  if unpaid is not null then
    raise exception 'the customer''s package invoice % is not paid yet; void it first', unpaid
      using errcode='PT409', detail='package_invoice_unpaid';
  end if;
  if not exists(select 1 from private.invoice_merchant_config c where c.singleton
      and c.registration_status = 'not_registered' and c.confirmed_at is not null) then
    raise exception 'the VAT registration setting changed; invoices need updating first'
      using errcode='PT409', detail='invoice_vat_status_changed';
  end if;
  return plan;
end;
$function$;
alter function internal.package_invoice_issue_check(private.package_invoice_requests) owner to postgres;
revoke all on function internal.package_invoice_issue_check(private.package_invoice_requests) from public;
