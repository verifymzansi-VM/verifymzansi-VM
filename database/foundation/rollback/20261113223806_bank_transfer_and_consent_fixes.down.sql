-- Reviewed rollback for updates/20261113223806_bank_transfer_and_consent_fixes.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. The website release from the same
-- pull request works with or without the update, so it need not be reverted
-- first.
--
-- It works only while the earlier rules can be put back: it refuses (55000)
-- once a bank reference is recorded more than once (a declined reference
-- recorded again, or the same reference for another amount or day), or a
-- refund reference holds a space, because the earlier unique index and check
-- would refuse those records. After that, fix forward.
--
-- It puts back the bodies of 20261113162457_staff_invoice_payments.sql (bank
-- transfer record and its staff view, the receipt read),
-- 20261113134500_communication_choices_and_signup_terms.sql (email history)
-- and 20261113021223 / 20261113085340 (refund commands, privacy export,
-- retention), the unique index invoice_transfers_reference_idx and the earlier
-- refund reference check; it drops internal.staff_refund_reference,
-- internal.assert_staff_refund_reason, internal.payment_refund_reference_rule,
-- the trigger payment_refund_requests_reference_rule and the index
-- invoice_transfers_open_reference_idx. Consent records the retention job
-- deleted stay deleted.
begin;
set local lock_timeout='5s';

lock table private.invoice_transfers in share row exclusive mode;
lock table private.payment_refund_requests in share row exclusive mode;

do $$
declare repeated bigint; spaced bigint;
begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)')) is distinct from 'fa71c56d4a686ea343f23d551985af9e'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.invoice_transfer_dto(private.invoice_transfers,uuid)')) is distinct from 'b91dbdd96bec847ddb165d6a663cc7cb'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_payment_receipt(uuid)')) is distinct from '764707a2ed4f9c87985e88b1afcde37c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_payment_refund(uuid,text,text,text,text)')) is distinct from '49d728545decec524a1a7dd6e09639e1'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_slot_refund(uuid,text,text,text,text)')) is distinct from 'cbea96f3d2df4f3255c565790df97fed'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text)')) is distinct from '31f93ac046f3cb4b73bc6896e8e4d2a3'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.frontend_privacy_export_data(uuid)')) is distinct from 'd30c545386536a718e824d1ec56f03ce'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.retention_verification(integer)')) is distinct from 'fe726b6672545b8b33901361eaf91226'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.list_my_email_history(integer)')) is distinct from 'bae293aa4451ea71502c27863c1cf5e6'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.staff_refund_reference(uuid,text)')) is distinct from 'ae254508232ecdd23136e0d47549673f'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.assert_staff_refund_reason(text,text,text)')) is distinct from '9bdc2d6c07af6313c21463bd5fdca8d0'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_refund_reference_rule()')) is distinct from '5f84fd9a07a75476cf72b741b20f5806'
    or to_regclass('private.invoice_transfers_open_reference_idx') is null then
    raise exception 'rollback precondition: the bank transfer and consent fixes update is not applied' using errcode='55000';
  end if;
  select count(*) into repeated from (select 1 from private.invoice_transfers
    group by upper(regexp_replace(bank_reference, '[^A-Za-z0-9]', '', 'g')) having count(*) > 1) d;
  select count(*) into spaced from private.payment_refund_requests where position(' ' in ozow_reference) > 0;
  if repeated > 0 or spaced > 0 then
    raise exception 'rollback precondition: % bank references are recorded more than once and % refund references hold a space; fix forward with a new update',
      repeated, spaced using errcode='55000';
  end if;
end$$;

-- The earlier rules: a bank reference once across every record; refund
-- references without spaces.
create unique index if not exists invoice_transfers_reference_idx on private.invoice_transfers
  (upper(regexp_replace(bank_reference, '[^A-Za-z0-9]', '', 'g')));
drop index if exists private.invoice_transfers_open_reference_idx;
drop trigger if exists payment_refund_requests_reference_rule on private.payment_refund_requests;
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_ozow_reference_check,
  add constraint payment_refund_requests_ozow_reference_check check (ozow_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$');

-- The earlier bodies, exactly as they were.
CREATE OR REPLACE FUNCTION internal.record_staff_invoice_payment(p_account_email text, p_term_days integer, p_slots integer, p_amount_cents bigint, p_bank_reference text, p_cleared_on text, p_cooling_off_waiver boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; reference text; reference_key text; cleared date; today date;
  plan private.plan_versions; prior private.invoice_transfers; made private.invoice_transfers; fingerprint text;
begin
  actor := internal.staff_actor('payments:refund');
  if length(btrim(coalesce(p_account_email, ''))) not between 3 and 254 or p_term_days is null
      or p_term_days not in (30, 90, 180) or p_slots is null or p_slots not between 1 and 25
      or p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'customer email, slot term, number of slots and amount received required'
      using errcode='22023', detail='invoice_payment_invalid';
  end if;
  if p_amount_cents > 5000000 then
    raise exception 'bank transfers above R50,000 cannot be recorded yet' using errcode='PT413', detail='invoice_amount_above_limit';
  end if;
  reference := regexp_replace(btrim(coalesce(p_bank_reference, '')), '\s+', ' ', 'g');
  if reference = '' then
    raise exception 'bank reference required' using errcode='22023', detail='bank_reference_required';
  end if;
  if reference !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,59}$'
      or length(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g')) < 4 then
    raise exception 'bank reference must be 4 to 60 letters, digits, spaces or . _ : / -'
      using errcode='22023', detail='bank_reference_invalid';
  end if;
  reference_key := upper(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g'));
  today := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  if p_cleared_on is null or p_cleared_on !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'date the money cleared required' using errcode='22023', detail='cleared_date_invalid';
  end if;
  begin
    cleared := p_cleared_on::date;
  exception when others then
    raise exception 'date the money cleared required' using errcode='22023', detail='cleared_date_invalid';
  end;
  if cleared > today or cleared < today - 90 then
    raise exception 'the money must have cleared today or in the last 90 days' using errcode='22023', detail='cleared_date_invalid';
  end if;
  if p_cooling_off_waiver is distinct from true then
    raise exception 'confirm the customer agreed in writing to the cooling-off waiver'
      using errcode='22023', detail='cooling_off_waiver_required';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  buyer := internal.invoice_customer_by_email(p_account_email);
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- One bank reference at a time, then the person.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-bank-reference:'||reference_key, 707));
  perform internal.lock_evidence_subject(buyer);
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.assert_staff_not_referrer(actor, buyer);
  select * into prior from private.invoice_transfers t
    where upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key;
  if found then
    if prior.recorded_by = actor and prior.account_id = buyer and prior.reason = btrim(p_reason)
        and prior.amount_received_cents = p_amount_cents and prior.cleared_on = cleared and prior.slots = p_slots
        and (select v.duration_days from private.plan_versions v where v.id = prior.plan_version_id) = p_term_days then
      return internal.invoice_transfer_dto(prior, actor) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that bank reference was already recorded (%)', replace(prior.status, '_', ' ')
      using errcode='PT409', detail='bank_reference_used';
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
    raise exception 'the customer''s ID review must be accepted before slots are recorded'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if plan.price_cents * p_slots <> p_amount_cents then
    raise exception 'the amount received is not the order total of % cents', plan.price_cents * p_slots
      using errcode='PT428', detail='invoice_amount_mismatch';
  end if;
  -- An early check of the slot limit; confirmation checks it again.
  if (internal.individual_slots_counted(fingerprint, buyer, null)->>'held')::integer + p_slots
      > internal.individual_slot_limit(fingerprint) then
    raise exception 'more slots than the person''s limit; raise the limit first' using errcode='PT429', detail='slot_limit_reached';
  end if;
  insert into private.invoice_transfers (account_id, plan_version_id, slots, amount_received_cents, bank_reference,
      cleared_on, cooling_off_waiver_confirmed, reason, recorded_by)
    values (buyer, plan.id, p_slots, p_amount_cents, reference, cleared, true, btrim(p_reason), actor)
    returning * into made;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  return internal.invoice_transfer_dto(made, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) owner to postgres;
revoke all on function internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) from public;
grant execute on function internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.invoice_transfer_dto(t private.invoice_transfers, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('transfer_id', t.id, 'status', t.status, 'account_id', t.account_id,
    'customer_email', (select u.email from auth.users u where u.id = t.account_id),
    'similar_records', (select count(*) from private.invoice_transfers x where x.id <> t.id
      and x.account_id = t.account_id and x.amount_received_cents = t.amount_received_cents
      and x.cleared_on = t.cleared_on and x.status <> 'declined'),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = t.account_id)),
    'term_days', (select v.duration_days from private.plan_versions v where v.id = t.plan_version_id),
    'slots', t.slots, 'amount_received_cents', t.amount_received_cents, 'bank_reference', t.bank_reference,
    'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'), 'reason', t.reason,
    'recorded_at', t.recorded_at, 'recorded_by_me', internal.same_identity(t.recorded_by, p_actor),
    'recorded_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = t.recorded_by)),
    'payment_id', t.payment_id);
$function$;
alter function internal.invoice_transfer_dto(private.invoice_transfers,uuid) owner to postgres;
revoke all on function internal.invoice_transfer_dto(private.invoice_transfers,uuid) from public;

CREATE OR REPLACE FUNCTION internal.get_payment_receipt(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('payment_id', p.id, 'owner_id', p.owner_id, 'amount_cents', p.amount_cents,
    'currency', p.currency, 'completed_at', p.completed_at, 'product_kind', p.product_kind,
    'label', coalesce(p.snapshot->>'label', initcap(p.snapshot->>'addon')||' add-on', 'Payment'),
    'slots', case when p.product_kind = 'plan' and jsonb_typeof(p.snapshot->'slots') = 'number'
      then p.snapshot->'slots' else 'null'::jsonb end,
    'invoice_description', i.description, 'invoice_number', i.invoice_number, 'issued_at', i.issued_at,
    'merchant_reference', p.merchant_reference, 'provider_transaction_id', p.provider_transaction_id,
    'status', p.status, 'fulfillment_status', p.fulfillment_status,
    'payment_method', p.provider,
    'bank_reference', (select t.bank_reference from private.invoice_transfers t where t.payment_id = p.id))
  from private.payments p left join private.invoices i on i.payment_id = p.id
  where p.id = p_payment_id;
$function$;
alter function internal.get_payment_receipt(uuid) owner to postgres;
revoke all on function internal.get_payment_receipt(uuid) from public;
grant execute on function internal.get_payment_receipt(uuid) to service_role;

CREATE OR REPLACE FUNCTION internal.staff_refund_repeat(p_actor uuid, p_payment_id uuid, p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare prior private.payment_refund_requests;
begin
  select * into prior from private.payment_refund_requests r where lower(r.ozow_reference) = lower(btrim(p_ozow_reference));
  if not found then return null; end if;
  if prior.payment_id = p_payment_id and prior.payment_line_id is not distinct from p_line_id and prior.kind = p_kind
      and prior.reason_code = p_reason_code and prior.reason = btrim(p_reason) and prior.requested_by = p_actor then
    return jsonb_build_object('request_id', prior.id, 'status', prior.status, 'kind', prior.kind,
      'released_activations', prior.released_activations,
      'payment_status', (select p.status from private.payments p where p.id = prior.payment_id), 'repeated', true);
  end if;
  raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
end;
$function$;
alter function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) owner to postgres;
revoke all on function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) from public;

CREATE OR REPLACE FUNCTION internal.record_staff_payment_refund(p_payment_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; pay private.payments; repeat jsonb; request private.payment_refund_requests;
  result jsonb; approval boolean; refunded_before bigint;
begin
  actor := internal.staff_actor('payments:refund');
  perform internal.assert_staff_refund_input(p_kind, p_reason_code, p_reason, p_ozow_reference);
  if p_payment_id is null then raise exception 'payment required' using errcode='22023'; end if;
  select p.owner_id into buyer from private.payments p where p.id = p_payment_id;
  if buyer is null then raise exception 'payment not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||p_payment_id::text, 0));
  perform internal.lock_evidence_subject(buyer);
  select * into pay from private.payments p where p.id = p_payment_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  repeat := internal.staff_refund_repeat(actor, pay.id, null, p_kind, p_reason_code, p_reason, p_ozow_reference);
  if repeat is not null then return repeat; end if;
  if exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id) or pay.status <> 'complete' then
    raise exception 'only a completed payment that was not reversed can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed') then
    raise exception 'a slot of this payment was already reversed; refund its other slots one by one' using errcode='PT409', detail='payment_slot_reversed';
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  approval := internal.refund_needs_approval(p_kind, refunded_before, pay.amount_cents);
  if not approval then
    result := internal.reverse_payment(pay.id, p_kind, btrim(p_reason));
    insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
      values (pay.id, actor, p_kind, btrim(p_reason), (result->>'released_activations')::integer);
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_refund_requests (payment_id, account_id, kind, reason_code, reason, ozow_reference,
      amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at, released_activations)
    values (pay.id, pay.owner_id, p_kind, p_reason_code, btrim(p_reason), btrim(p_ozow_reference), pay.amount_cents, refunded_before,
      approval, case when approval then 'awaiting_approval' else 'applied' end, actor,
      case when approval then null else statement_timestamp() end,
      case when approval then null else (result->>'released_activations')::integer end)
    returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', p_kind,
    'released_activations', request.released_activations,
    'payment_status', case when approval then pay.status else p_kind end, 'repeated', false);
end;
$function$;
alter function internal.record_staff_payment_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function internal.record_staff_payment_refund(uuid,text,text,text,text) from public;
grant execute on function internal.record_staff_payment_refund(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.record_staff_slot_refund(p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; payment uuid; pay private.payments; line private.payment_lines; repeat jsonb;
  request private.payment_refund_requests; result jsonb; approval boolean; refunded_before bigint;
begin
  actor := internal.staff_actor('payments:refund');
  perform internal.assert_staff_refund_input(p_kind, p_reason_code, p_reason, p_ozow_reference);
  if p_line_id is null then raise exception 'slot required' using errcode='22023'; end if;
  select p.owner_id, p.id into buyer, payment from private.payment_lines l join private.payments p on p.id = l.payment_id
    where l.id = p_line_id;
  if buyer is null then raise exception 'slot payment line not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_evidence_subject(buyer);
  select * into pay from private.payments p where p.id = payment for update;
  select * into line from private.payment_lines l where l.id = p_line_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  repeat := internal.staff_refund_repeat(actor, pay.id, line.id, p_kind, p_reason_code, p_reason, p_ozow_reference);
  if repeat is not null then return repeat; end if;
  if pay.status <> 'complete' or line.status <> 'open' then
    raise exception 'only an open slot of a completed payment can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  approval := internal.refund_needs_approval(p_kind, refunded_before, line.amount_cents);
  if not approval then
    result := internal.record_staff_slot_reversal(line.id, p_kind, btrim(p_reason));
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_refund_requests (payment_id, payment_line_id, account_id, kind, reason_code, reason,
      ozow_reference, amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at, released_activations)
    values (pay.id, line.id, pay.owner_id, p_kind, p_reason_code, btrim(p_reason), btrim(p_ozow_reference),
      line.amount_cents, refunded_before, approval, case when approval then 'awaiting_approval' else 'applied' end, actor,
      case when approval then null else statement_timestamp() end,
      case when approval then null else (result->>'released_activations')::integer end)
    returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', p_kind, 'line_id', line.id,
    'released_activations', request.released_activations,
    'payment_status', coalesce(result->>'payment_status', pay.status), 'repeated', false);
end;
$function$;
alter function internal.record_staff_slot_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function internal.record_staff_slot_refund(uuid,text,text,text,text) from public;
grant execute on function internal.record_staff_slot_refund(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.frontend_privacy_export_data(p_subject uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare entry record;items jsonb;row_count integer;result jsonb:='{}';size_so_far bigint:=0;
begin
  for entry in select * from (values
    ('profile',$q$select account_id,display_name,bio,legal_first_name,legal_last_name,legal_name_locked_at,created_at,updated_at from private.profiles where account_id=$1$q$),
    ('account',$q$select id,email,email_confirmed_at,phone,phone_confirmed_at,created_at,last_sign_in_at from auth.users where id=$1 and deleted_at is null$q$),
    ('listing_drafts',$q$select category_key,price_mode,price_cents,price_negotiable,revision,expires_at from private.listing_price_drafts where owner_id=$1$q$),
    ('posts',$q$select p.id,p.kind,p.area,p.category_key,p.activity_key,p.title,p.description,p.province_id,p.city_id,p.locality_label,
      p.status,p.status_reason,p.created_at,p.submitted_at,p.published_at,p.visible_until,p.edit_of,
      l.price_mode,l.price_cents,l.price_negotiable,l.attributes,b.business_type,e.starts_at,e.ends_at,e.timezone,
      s.slug,d.data presentation,d.contacts contact_details,c.channels
      from private.posts p left join private.listing_details l on l.post_id=p.id left join private.business_details b on b.post_id=p.id
      left join private.event_details e on e.post_id=p.id left join private.post_slugs s on s.post_id=p.id
      left join private.post_presentations d on d.post_id=p.id left join private.post_contacts c on c.post_id=p.id
      where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('post_reviews',$q$select m.post_id,m.edit_id,m.decision,m.reason,m.decided_at,m.price_only
      from private.moderation_log m join private.posts p on p.id=m.post_id where p.owner_id=$1 order by m.decided_at,m.id$q$),
    ('media_metadata',$q$select id,kind,size_bytes,mime,width,height,state,created_at,deleted_at from private.media_objects where owner_id=$1 order by created_at,id$q$),
    ('payments',$q$select id,product_kind,target_post_id,amount_cents,currency,status,fulfillment_status,merchant_reference,provider,created_at,completed_at
      from private.payments where owner_id=$1 order by created_at,id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason
      from private.post_activations where owner_id=$1 order by activated_at,id$q$),
    ('event_submissions',$q$select post_id,submitted_at,released_at,release_reason
      from private.event_submissions where owner_id=$1 order by submitted_at,id$q$),
    ('introductory_trials',$q$select post_id,trial_entitlement_id,claimed_at,converted_at
      from private.post_trial_claims where owner_id=$1 order by claimed_at,post_id$q$),
    ('posting_terms',$q$select version,document_hash,accepted_at from private.posting_terms_acceptances where owner_id=$1 order by accepted_at,version$q$),
    ('verification_cases',$q$select id,kind,status,created_at from private.evidence_cases where subject_id=$1 order by created_at,id$q$),
    ('verification_reviews',$q$select r.case_id,r.reason,r.decision,r.created_at from private.verification_return_requests r join private.evidence_cases c on c.id=r.case_id
      where c.subject_id=$1 order by r.created_at,r.id$q$),
    ('evidence_metadata',$q$select id,case_id,purpose,state,size_bytes,created_at,retain_until,deleted_at
      from private.evidence_artifacts where owner_id=$1 order by created_at,id$q$),
    ('phone_verification',$q$select phone,verified_at,contact_changed_at,revoked_at from private.verification_phone_proofs where owner_id=$1 order by verified_at,id$q$),
    ('locality_verification',$q$select province_id,city_id,assurance,confirmed_at from private.verification_localities where owner_id=$1$q$),
    ('enquiries_sent',$q$select id,post_id,message,created_at from private.enquiries where sender_account_id=$1 order by created_at,id$q$),
    ('enquiries_received',$q$select id,post_id,message,status,created_at from private.enquiries where owner_id=$1 order by created_at,id$q$),
    ('notifications',$q$select id,kind,post_id,created_at,read_at from private.notifications where account_id=$1 order by created_at,id$q$),
    ('reports_submitted',$q$select id,post_id,coalesce(frontend_reason,category) category,description,status,created_at,resolved_at
      from private.reports where reporter_id=$1 order by created_at,id$q$),
    ('moderation_decisions',$q$select id,kind,reason,starts_at,ends_at,active from private.frontend_appealable_actions
      where account_id=$1 order by starts_at,id$q$),
    ('appeals',$q$select id,action_id,kind,reason,status,reviewer_rationale,created_at,resolved_at from private.frontend_appeals
      where appellant_id=$1 order by created_at,id$q$),
    ('organisation_applications',$q$select id,organisation_id,programme_id,post_id,reason,member_reference,share_representative_name,consented_at,
      status,info_request,info_response,decision_at,decision_note,created_at from private.organisation_applications where applicant_id=$1 order by created_at,id$q$),
    ('organisation_affiliations',$q$select a.id,a.organisation_id,a.programme_id,a.post_id,a.affiliation_type,a.status,a.confirmed_at,a.revoked_at,a.revoke_reason
      from private.organisation_affiliations a join private.posts p on p.id=a.post_id where p.owner_id=$1 order by a.created_at,a.id$q$),
    ('organisation_roles',$q$select organisation_id,role,created_at from private.organisation_admins where account_id=$1 order by created_at,organisation_id$q$),
    ('sponsorships',$q$select id,organisation_id,post_id,sponsor_type,status,starts_at,ends_at,ended_at,end_reason
      from private.organisation_sponsorships where owner_id=$1 order by created_at,id$q$),
    ('partner_account',$q$select id,code,status,commission_bps,created_at,updated_at from private.partners where account_id=$1 order by created_at,id$q$),
    ('partner_commissions',$q$select c.id,c.base_cents,c.rate_bps,c.amount_cents,c.status,c.eligible_at,c.approved_at,c.paid_at,c.reversed_at
      from private.partner_commissions c join private.partners p on p.id=c.partner_id where p.account_id=$1 order by c.created_at,c.id$q$),
    ('acquisition',$q$select source,campaign,landing_path,referrer_host,first_touch_at,recorded_at from private.account_acquisitions where account_id=$1$q$),
    ('account_closure',$q$select closed_at,evidence_delete_after from private.account_closures where user_id=$1$q$),
    ('data_requests',$q$select id,type,description,status,received_at,due_by,extended_due_at,extension_reason,response_summary,completed_at
      from private.privacy_requests where subject_user_id=$1 order by received_at,id$q$)
  ) as registry(dataset,statement) loop
    execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb),count(*) from ('||entry.statement||' limit 2501)x'
      into items,row_count using p_subject;
    size_so_far:=size_so_far+octet_length(items::text);
    if row_count>2500 or size_so_far>4194304 then raise exception 'privacy export exceeds the direct delivery limit' using errcode='PT413';end if;
    result:=result||jsonb_build_object(entry.dataset,items);
  end loop;
  return result;
end$function$;
alter function internal.frontend_privacy_export_data(uuid) owner to postgres;
revoke all on function internal.frontend_privacy_export_data(uuid) from public;

CREATE OR REPLACE FUNCTION internal.retention_verification(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate record; numbers integer:=0; challenges integer; proofs integer; localities integer;
  acceptances integer; histories integer:=0; cases uuid[];
begin
  for candidate in
    select s.id,s.owner_id,s.case_id from private.verification_identity_submissions s
      join private.evidence_cases c on c.id=s.case_id
      join private.evidence_artifacts a on a.id=s.id_artifact_id
    where s.number_erased_at is null and c.status<>'open'
      and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp())
      and not internal.evidence_fraud_held(s.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=s.owner_id and h.released_at is null)
    order by s.owner_id,s.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    update private.verification_identity_submissions
      set number_ciphertext=null,number_iv=null,number_tag=null,number_erased_at=statement_timestamp()
    where id=candidate.id and number_erased_at is null
      and exists(select 1 from private.evidence_cases c join private.evidence_artifacts a on a.case_id=c.id
        where c.id=candidate.case_id and c.status<>'open' and a.id=id_artifact_id
          and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp()))
      and not internal.evidence_fraud_held(candidate.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=candidate.owner_id and h.released_at is null);
    if found then numbers:=numbers+1; end if;
  end loop;

  delete from private.verification_phone_proofs where id in(select p.id from private.verification_phone_proofs p
    where p.revoked_at<statement_timestamp()-interval '30 days' order by p.revoked_at limit p_limit for update skip locked);
  get diagnostics proofs=row_count;
  delete from private.verification_phone_challenges where id in(select c.id from private.verification_phone_challenges c
    where c.expires_at<statement_timestamp()-interval '24 hours'
      and not exists(select 1 from private.verification_phone_proofs p where p.challenge_id=c.id)
    order by c.expires_at limit p_limit for update skip locked);
  get diagnostics challenges=row_count;

  -- Thirty days after closure: home area and terms acceptance go.
  delete from private.verification_localities where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
    order by x.closed_at limit p_limit);
  get diagnostics localities=row_count;
  delete from private.posting_terms_acceptances where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
    order by x.closed_at limit p_limit);
  get diagnostics acceptances=row_count;

  -- Five years after closure: the verification history of the account, once
  -- every file is deleted and no ban still depends on it.
  for candidate in
    select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '5 years'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and not exists(select 1 from private.evidence_artifacts a where a.owner_id=x.user_id and a.state<>'deleted')
      and not exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
        where c.subject_id=x.user_id and (exists(select 1 from private.banned_identities b where b.decision_id=d.id)
          or exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id)))
      and (exists(select 1 from private.evidence_cases c where c.subject_id=x.user_id
          and not exists(select 1 from private.decisions d where d.case_id=c.id and d.status='approved' and d.action='restrict_account'))
        or exists(select 1 from private.verification_phone_challenges p where p.owner_id=x.user_id))
    order by x.closed_at limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.user_id::text,2408)) then continue; end if;
    -- Candidate discovery may precede other subjects' work in this batch.
    -- Recheck preservation rules under the same lock used by hold writers.
    if exists(select 1 from private.legal_holds h where h.subject_id=candidate.user_id and h.released_at is null)
      or exists(select 1 from private.evidence_cases c join private.evidence_fraud_holds h on h.case_id=c.id
        where c.subject_id=candidate.user_id and h.closed_at is null)
      or exists(select 1 from private.evidence_artifacts a where a.owner_id=candidate.user_id and a.state<>'deleted')
      or exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
        where c.subject_id=candidate.user_id and (exists(select 1 from private.banned_identities b where b.decision_id=d.id)
          or exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id))) then continue; end if;
    select coalesce(array_agg(c.id),'{}') into cases from private.evidence_cases c where c.subject_id=candidate.user_id;
    delete from private.identity_submission_names where owner_id=candidate.user_id;
    delete from private.verification_current_submissions where case_id=any(cases);
    delete from private.identity_review_proposals where submission_id in(select s.id from private.verification_identity_submissions s
      where s.owner_id=candidate.user_id) or decision_id in(select d.id from private.decisions d where d.case_id=any(cases));
    delete from private.identity_ban_proposal_requests where owner_id=candidate.user_id;
    delete from private.accepted_identity_facts where owner_id=candidate.user_id;
    delete from private.decisions where case_id=any(cases) and not (status='approved' and action='restrict_account');
    delete from private.evidence_access_log where case_id=any(cases);
    delete from private.evidence_fraud_holds where case_id=any(cases);
    delete from private.verification_identity_submissions where owner_id=candidate.user_id;
    delete from private.evidence_artifacts where owner_id=candidate.user_id;
    delete from private.evidence_cases c where c.id=any(cases) and not exists(select 1 from private.decisions d where d.case_id=c.id);
    delete from private.verification_phone_proofs where owner_id=candidate.user_id;
    delete from private.verification_phone_challenges where owner_id=candidate.user_id;
    delete from private.legal_holds where subject_id=candidate.user_id and released_at is not null;
    histories:=histories+1;
  end loop;
  return jsonb_build_object('identity_numbers_erased',numbers,'phone_proofs',proofs,'phone_challenges',challenges,
    'closed_account_localities',localities,'closed_account_terms_acceptances',acceptances,
    'closed_account_verification_histories',histories);
end;
$function$;
alter function internal.retention_verification(integer) owner to postgres;
revoke all on function internal.retention_verification(integer) from public;

CREATE OR REPLACE FUNCTION internal.list_my_email_history(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); items jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid limit' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'at', x.at)
      order by x.created_at desc, x.id), '[]'::jsonb)
    into items
  from (select o.id, o.kind, o.created_at,
      case when o.processed_at is not null then 'sent' else 'failed' end as status,
      coalesce(o.processed_at, o.created_at) as at
    from private.outbox_events o
    where o.owner_id = actor and (o.processed_at is not null
      or (o.delivery_attempts >= 8 and o.delivery_error is distinct from 'outcome_unknown'
        and (o.delivery_until is null or o.delivery_until < statement_timestamp())))
    order by o.created_at desc, o.id
    limit p_limit) x;
  return jsonb_build_object('items', items);
end;
$function$;
alter function internal.list_my_email_history(integer) owner to postgres;
revoke all on function internal.list_my_email_history(integer) from public;
grant execute on function internal.list_my_email_history(integer) to authenticated;

drop function if exists internal.payment_refund_reference_rule();
drop function if exists internal.staff_refund_reference(uuid,text);
drop function if exists internal.assert_staff_refund_reason(text,text,text);

commit;
