-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.request_package_add_invoice(p_package_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); q record; plan private.plan_versions; total bigint;
  unpaid text; prior private.package_invoice_requests; waiting private.package_invoice_requests;
  made private.package_invoice_requests; consent jsonb := internal.customer_invoice_consent();
begin
  if p_package_id is null or p_slots is null or p_expected_total_cents is null or p_request_id is null then
    raise exception 'package, number of slots, total and request id required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before asking for an invoice'
      using errcode='22023', detail='invoice_consent_required';
  end if;
  perform internal.lock_evidence_subject(actor);
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  if internal.current_verified_identity(actor) is null then
    raise exception 'your ID review must be accepted before you ask for a package invoice' using errcode='PT412';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
  -- The same request again (a retried submission) returns the first answer.
  select * into prior from private.package_invoice_requests r
    where r.account_id = actor and r.member_request_id = p_request_id;
  if found then
    if prior.kind = 'add' and prior.package_id = p_package_id and prior.slots = p_slots then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(prior, null) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that request already asked for another invoice' using errcode='PT409', detail='invoice_request_conflict';
  end if;
  select x.* into q from internal.slot_package_add_quote(actor) x;
  if q.package_id is distinct from p_package_id then
    raise exception 'this package has ended' using errcode='PT409', detail='package_ended';
  end if;
  if q.days_left < 10 then
    raise exception 'slots are added by invoice while 10 or more days of the package are left'
      using errcode='PT409', detail='package_add_invoice_too_late';
  end if;
  select v.* into plan from private.plan_versions v where v.id = q.plan_id;
  if not found then
    raise exception 'this package term is not on sale' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  -- 250 in all, and at most 245 in one add (a package starts at 5).
  if p_slots < 1 or p_slots > 245 or q.places + p_slots > 250 then
    raise exception 'a package holds at most 250 slots, and one add at most 245' using errcode='22023',
      detail='package_slots_invalid';
  end if;
  total := q.unit_price_cents * p_slots;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  unpaid := internal.package_invoice_blocking(actor, null);
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
    if waiting.kind = 'add' and waiting.package_id = p_package_id and waiting.slots = p_slots
        and waiting.unit_price_cents = q.unit_price_cents then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(waiting, null) || jsonb_build_object('repeated', true);
    end if;
  end if;
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
      unit_price_cents, total_cents, consent_at, consent_version, consent_terms_version, kind, package_id, days_left)
    values (actor, p_request_id, plan.id, plan.duration_days, p_slots, q.unit_price_cents, total, statement_timestamp(),
      consent->>'version', (select c.version from private.posting_terms_current c where c.singleton),
      'add', q.package_id, q.days_left)
    returning * into made;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.package_invoice_request_dto(made, null) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) owner to postgres;
revoke all on function internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) from public;
grant execute on function internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) to authenticated;
