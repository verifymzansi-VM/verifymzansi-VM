-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.request_package_invoice(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); plan private.plan_versions; total bigint; unpaid text;
  prior private.package_invoice_requests; waiting private.package_invoice_requests; made private.package_invoice_requests;
  consent jsonb := internal.customer_invoice_consent();
begin
  if p_plan_id is null or p_slots is null or p_expected_total_cents is null or p_request_id is null then
    raise exception 'package term, number of slots, total and request id required' using errcode='22023';
  end if;
  -- Paid by bank transfer, the slots start without the 7-day cooling-off: the
  -- member confirms it when asking (posting-v5), in the invoice's own words.
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before asking for an invoice'
      using errcode='22023', detail='invoice_consent_required';
  end if;
  perform internal.lock_evidence_subject(actor);
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  select * into plan from private.plan_versions v
    where v.id = p_plan_id and v.retired_at is null and internal.slot_package_plan(v.plan_code);
  if not found then raise exception 'this package term is not on sale' using errcode='22023'; end if;
  -- The package checkout's numbers: 5 to 250 slots; an invoice at any amount.
  if p_slots < 5 or p_slots > 250 then
    raise exception 'a package has 5 to 250 slots' using errcode='22023', detail='package_slots_invalid';
  end if;
  if internal.current_verified_identity(actor) is null then
    raise exception 'your ID review must be accepted before you ask for a package invoice' using errcode='PT412';
  end if;
  total := plan.price_cents * p_slots;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
  -- The same request again (a retried submission) returns the first answer.
  select * into prior from private.package_invoice_requests r
    where r.account_id = actor and r.member_request_id = p_request_id;
  if found then
    if prior.plan_version_id = plan.id and prior.slots = p_slots then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(prior, null) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that request already asked for another invoice' using errcode='PT409', detail='invoice_request_conflict';
  end if;
  if internal.slot_package_open(actor) then
    raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
  end if;
  select i.invoice_number into unpaid from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
    where i.account_id = actor and i.status = 'issued' and internal.slot_package_plan(v.plan_code)
    order by i.issued_at limit 1;
  if unpaid is not null then
    raise exception 'your package invoice % is not paid yet; pay it, or ask us to cancel it first', unpaid
      using errcode='PT409', detail='package_invoice_unpaid';
  end if;
  -- One request open at a time. The same order again: the waiting request
  -- stands. Another order replaces it while no staff member has prepared it.
  select * into waiting from private.package_invoice_requests r
    where r.account_id = actor and r.status in ('requested', 'awaiting_approval')
    for update;
  if found then
    if waiting.status = 'awaiting_approval' then
      raise exception 'your invoice is being prepared; ask us to cancel it before asking for another'
        using errcode='PT409', detail='package_invoice_request_open';
    end if;
    if waiting.plan_version_id = plan.id and waiting.slots = p_slots then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(waiting, null) || jsonb_build_object('repeated', true);
    end if;
  end if;
  -- At most 10 new requests per account in 24 hours (each other order is a
  -- new request), so the staff queue cannot be flooded.
  if (select count(*) from private.package_invoice_requests r
      where r.account_id = actor and r.requested_at > statement_timestamp() - interval '24 hours') >= 10 then
    raise exception 'too many invoice requests today; try again tomorrow or contact us'
      using errcode='PT429', detail='package_invoice_requests_limit';
  end if;
  if waiting.id is not null then
    update private.package_invoice_requests set status = 'withdrawn', closed_at = statement_timestamp()
      where id = waiting.id;
  end if;
  insert into private.package_invoice_requests (account_id, member_request_id, plan_version_id, term_days, slots,
      unit_price_cents, total_cents, consent_at, consent_version, consent_terms_version)
    values (actor, p_request_id, plan.id, plan.duration_days, p_slots, plan.price_cents, total, statement_timestamp(),
      consent->>'version', (select c.version from private.posting_terms_current c where c.singleton))
    returning * into made;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.package_invoice_request_dto(made, null) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) owner to postgres;
revoke all on function internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) from public;
grant execute on function internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) to authenticated;
