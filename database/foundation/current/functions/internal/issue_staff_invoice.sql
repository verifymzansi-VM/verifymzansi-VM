-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.issue_staff_invoice(p_account_email text, p_term_days integer, p_slots integer, p_due_days integer, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; plan private.plan_versions; fingerprint text; prior private.customer_invoices;
  made private.customer_invoices; issued_on date; year_number integer; next_number integer;
begin
  actor := internal.staff_actor('payments:refund');
  if length(btrim(coalesce(p_account_email, ''))) not between 3 and 254 or p_term_days is null
      or p_term_days not in (30, 90, 180) or p_slots is null or p_slots not between 1 and 25
      or p_due_days is null or p_due_days not between 1 and 30 or p_request_id is null then
    raise exception 'customer email, slot term, number of slots and days to pay required'
      using errcode='22023', detail='invoice_issue_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  buyer := internal.invoice_customer_by_email(p_account_email);
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.lock_evidence_subject(buyer);
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.assert_staff_not_referrer(actor, buyer);
  -- The same request again (a retried submission) returns the first invoice.
  select * into prior from private.customer_invoices i where i.issued_by = actor and i.request_id = p_request_id;
  if found then
    if prior.account_id = buyer and prior.slots = p_slots and prior.issue_reason = btrim(p_reason)
        and prior.due_on - internal.customer_invoice_day(prior.issued_at) = p_due_days
        and (select v.duration_days from private.plan_versions v where v.id = prior.plan_version_id) = p_term_days then
      return internal.customer_invoice_dto(prior, actor) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that request already issued another invoice' using errcode='PT409', detail='invoice_request_conflict';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id = buyer) then
    raise exception 'the customer''s account cannot use slots now' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  select * into plan from private.plan_versions v
    where v.plan_code = 'individual_'||p_term_days||'d' and v.retired_at is null and v.is_public
      and internal.individual_slot_plan(v.plan_code)
    order by v.version desc limit 1;
  if not found then
    raise exception 'no slot for that term is on sale' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  fingerprint := internal.current_verified_identity(buyer);
  if fingerprint is null then
    raise exception 'the customer''s ID review must be accepted before an invoice is issued'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if plan.price_cents * p_slots > 5000000 then
    raise exception 'invoices above R50,000 cannot be issued yet' using errcode='PT413', detail='invoice_amount_above_limit';
  end if;
  -- An early check of the slot limit; the payment checks it again.
  if (internal.individual_slots_counted(fingerprint, buyer, null)->>'held')::integer + p_slots
      > internal.individual_slot_limit(fingerprint) then
    raise exception 'more slots than the person''s limit; raise the limit first' using errcode='PT429', detail='slot_limit_reached';
  end if;
  -- The invoice says "not registered for VAT": only while the merchant setting says so.
  if not exists(select 1 from private.invoice_merchant_config c where c.singleton
      and c.registration_status = 'not_registered' and c.confirmed_at is not null) then
    raise exception 'the VAT registration setting changed; invoices need updating first'
      using errcode='PT409', detail='invoice_vat_status_changed';
  end if;
  issued_on := internal.customer_invoice_day(statement_timestamp());
  year_number := extract(year from issued_on)::integer;
  insert into private.customer_invoice_numbers as n (invoice_year, last_number) values (year_number, 1)
    on conflict (invoice_year) do update set last_number = n.last_number + 1
    returning n.last_number into next_number;
  insert into private.customer_invoices (invoice_number, invoice_year, sequence_number, account_id, plan_version_id,
      slots, unit_price_cents, total_cents, description, due_on, issued_by, issue_reason, request_id, seller)
    values ('VM-' || year_number::text || '-' || lpad(next_number::text, 6, '0'), year_number, next_number, buyer, plan.id,
      p_slots, plan.price_cents, plan.price_cents * p_slots,
      case when p_slots = 1 then plan.label else p_slots::text || ' × ' || plan.label end,
      issued_on + p_due_days, actor, btrim(p_reason), p_request_id,
      jsonb_build_object('legal_name', 'Verifymzansi (Pty) Ltd', 'registration_number', '2026/155305/07',
        'vat_registered', false))
    returning * into made;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  return internal.customer_invoice_dto(made, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) owner to postgres;
revoke all on function internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) from public;
grant execute on function internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) to authenticated;
