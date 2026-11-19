-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.package_invoice_issue_check(r private.package_invoice_requests)
 RETURNS private.plan_versions
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare plan private.plan_versions; unpaid text;
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
