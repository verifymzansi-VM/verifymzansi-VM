-- Reviewed rollback for updates/20261126053701_invoice_pay_link.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Deploy a website without the
-- invoice payment link first.
-- It refuses (55000) unless every function has the update's body, and once an
-- invoice email was queued (an outbox row of kind invoice_issued exists): that
-- email and its link are the member's. Otherwise it puts back the replaced
-- functions byte for byte (the three member invoice functions with their
-- earlier arguments), drops the functions the update added, the outbox kind and
-- private.customer_invoices.pay_link_hash.
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.notify_invoice_issued()'),('internal.claim_supported_notification_outbox(text[],integer)'),('internal.get_payment_receipt(uuid)'),('api.get_my_invoice(text)'),('api.save_my_invoice_billing(text,integer,text,text,text)'),('api.start_invoice_payment(text,bigint,boolean)'),('internal.get_my_invoice(text)'),('internal.save_my_invoice_billing(text,integer,text,text,text)'),('internal.start_invoice_payment(text,bigint,boolean)'),('internal.get_my_invoice(text,text)'),('internal.save_my_invoice_billing(text,integer,text,text,text,text)'),('internal.start_invoice_payment(text,bigint,boolean,text)'),('internal.customer_invoice_for_caller(text,text)'),('internal.prepare_invoice_email(uuid,text)'),('api.prepare_invoice_email(uuid,text)'),('api.get_invoice_by_link(text)'),('api.save_invoice_billing_by_link(text,integer,text,text,text)'),('api.start_invoice_payment_by_link(text,bigint,boolean)')) v(sig)
  loop
    if shape not in (
        'internal.notify_invoice_issued() 57575d30894464764cd952b702dc9c62',
        'internal.claim_supported_notification_outbox(text[],integer) c92c5bede77fd5f4df4e60199a43adfd',
        'internal.get_payment_receipt(uuid) 0826c70e07ee5239d5bfe9c2a6cd9600',
        'api.get_my_invoice(text) df0d980d68553a2d987292450f7997cc',
        'api.save_my_invoice_billing(text,integer,text,text,text) 0f4ebfbb0a3dc8b068803007ec95bca6',
        'api.start_invoice_payment(text,bigint,boolean) c05e01c01b34d4ae7e319849bd7c1d4d',
        'internal.get_my_invoice(text) absent',
        'internal.save_my_invoice_billing(text,integer,text,text,text) absent',
        'internal.start_invoice_payment(text,bigint,boolean) absent',
        'internal.get_my_invoice(text,text) 95548dc149e7a4507baa227d8e3c606f',
        'internal.save_my_invoice_billing(text,integer,text,text,text,text) 32a0aa61c578ecd64030a83b4c24976e',
        'internal.start_invoice_payment(text,bigint,boolean,text) 17f6fcaae211453eec7ad232adbd92ea',
        'internal.customer_invoice_for_caller(text,text) 0160fb59df73dc72d2a4fa0449c91e5a',
        'internal.prepare_invoice_email(uuid,text) 9c2e40f1b2996022919e8fa136af884d',
        'api.prepare_invoice_email(uuid,text) ac97f4b15722956f2396463264460943',
        'api.get_invoice_by_link(text) 7d4fba24f54575ad7a34bf81c2bd968b',
        'api.save_invoice_billing_by_link(text,integer,text,text,text) f4ab3a6005a76a6b64d99cf7ca60905f',
        'api.start_invoice_payment_by_link(text,bigint,boolean) 8a67bd41ec4b078612902a76d548078b') then
      raise exception 'rollback precondition: the invoice payment link update is not applied as reviewed (%)', shape using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from private.outbox_events o where o.kind = 'invoice_issued') then
    raise exception 'rollback precondition: an invoice email was queued; it and its link stay (use a forward fix)'
      using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.notify_invoice_issued()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Staff issue an invoice to a member's account: the member is asked to pay it.
  if new.account_id is null or new.status<>'issued' then return null; end if;
  perform internal.notify_account(new.account_id,'invoice_issued',new.id,null,null);
  return null;
end;
$function$;
alter function internal.notify_invoice_issued() owner to postgres;
revoke all on function internal.notify_invoice_issued() from public;

CREATE OR REPLACE FUNCTION internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  -- Each kind once; 27 kinds since the sticker renewal reminder.
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 27 or coalesce(array_ndims(p_supported_kinds),0)<>1
    or (select count(distinct coalesce(k,'')) from unnest(p_supported_kinds) k)<>cardinality(p_supported_kinds) then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice','free_credit_reminder','staff_privacy_request','staff_appeal','staff_report','sticker_renewal_reminder')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid limit' using errcode='22023'; end if;
  with due as (select id from private.outbox_events where kind=any(p_supported_kinds) and processed_at is null
    and delivery_attempts<8 and delivery_after<=statement_timestamp()
    and (delivery_until is null or delivery_until<statement_timestamp())
    order by created_at,id for update skip locked limit p_limit), claimed as (
    update private.outbox_events o set delivery_attempts=o.delivery_attempts+1,
      delivery_claim=pg_catalog.gen_random_uuid(),delivery_until=statement_timestamp()+interval '90 seconds'
    from due where o.id=due.id returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'subject_id',o.subject_id,
    'owner_id',o.owner_id,'claim_token',o.delivery_claim,'locked_until',o.delivery_until,
    'attempts',o.delivery_attempts,'recipient',case when u.email_confirmed_at is not null and not u.is_anonymous and (o.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') or not exists(select 1 from private.account_closures c where c.user_id=u.id))
      and (o.kind<>'slot_renewal_reminder' or internal.slot_renewal_due(o.subject_id,o.owner_id))
      and (o.kind<>'term_ending_notice' or internal.term_ending_notice_due(o.subject_id,o.owner_id))
      and (o.kind<>'free_credit_reminder' or o.dedupe_key=internal.free_credit_reminder_key(o.subject_id,o.owner_id))
      and (o.kind not in('staff_privacy_request','staff_appeal','staff_report') or internal.staff_email_due(o.kind,o.subject_id,o.owner_id))
      and (o.kind<>'sticker_renewal_reminder' or o.dedupe_key=internal.sticker_renewal_reminder_key(o.subject_id,o.owner_id)) then u.email end,
    'post_title',p.title,'post_id',p.id,'created_at',o.created_at,'notice_reason',case when o.kind='account_warning' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where r.id=o.subject_id and w.account_id=o.owner_id) end,
    'deletes_at',p.deletes_at,
    'holds_slot',case when p.id is not null then exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null) end,
    'trial_ends_at',tr.ends_at,
    'trial_funds_post',case when tr.id is not null then exists(select 1 from private.post_activations a
      join private.posts fp on fp.id=a.post_id where a.entitlement_id=tr.id and a.released_at is null and fp.status='live') end,
    -- The renewal reminder: when the slot ends, and whether more than one of
    -- the member's slots ends unrenewed within 7 days ("Renew all").
    'slot_ends_at',sg.ends_at,
    'renewal_kind',case when sg.id is not null then 'individual' end,
    'slot_renew_all',case when sg.id is not null then (select count(*)>1 from private.entitlements x
      where x.owner_id=o.owner_id and x.status='active' and x.ends_at<=statement_timestamp()+interval '7 days'
        and internal.slot_renewal_due(x.id,o.owner_id)) end,
    -- The term-ending notice: when the term ends, what it is, whether the
    -- member can sign in now (not while banned or suspended) and, for an
    -- Individual slot, whether the Multi-listing package its post moves into
    -- when it ends (internal.slot_package_now) runs past that end.
    'term_ends_at',tg.ends_at,
    'term_has_access',case when tg.id is not null then exists(select 1 from private.current_account_access a where a.id=o.owner_id) end,
    'term_kind',case when tg.id is null then null when tg.package_id is not null then 'package'
      when exists(select 1 from private.payment_lines l join private.plan_versions v on v.id=l.plan_version_id
        where l.id=tg.payment_line_id and internal.individual_slot_plan(v.plan_code)) then 'individual'
      else 'other' end,
    'term_package_continues',case when tg.id is not null and tg.package_id is null
      and exists(select 1 from private.payment_lines l join private.plan_versions v on v.id=l.plan_version_id
        where l.id=tg.payment_line_id and internal.individual_slot_plan(v.plan_code))
      then exists(select 1 from internal.slot_package_now(o.owner_id) n where n.ends_at>tg.ends_at) end,
    -- The free credit reminder: when the gift ends.
    'credit_ends_at',fc.ends_at,
    -- The staff deadline emails: the request type, appeal kind or report
    -- reason, the report's severity, when it was received and its deadline
    -- (an appeal 3 and a report 2 business days after it was received).
    'staff_item_type',case o.kind when 'staff_privacy_request' then sp.type when 'staff_appeal' then sa.kind
      when 'staff_report' then coalesce(sr.frontend_reason,sr.category) end,
    'staff_severity',sr.severity,
    'staff_received_at',coalesce(sp.received_at,sa.created_at,sr.created_at),
    'staff_due_at',case o.kind when 'staff_privacy_request' then sp.effective_due_at
      when 'staff_appeal' then internal.staff_due_after(sa.created_at,3)
      when 'staff_report' then internal.staff_due_after(sr.created_at,2) end,
    -- The sticker renewal reminder: which sticker, when it ends and its
    -- business (the email links to that business's verification page).
    'sticker_kind',sc.kind,
    'sticker_expires_at',sc.expires_at,
    'sticker_business_id',sc.business_id) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on o.kind not in('staff_privacy_request','staff_appeal','staff_report','sticker_renewal_reminder')
      and p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end
    left join private.entitlements tr on o.kind='trial_started' and tr.id=o.subject_id and tr.source='intro_trial'
      and tr.owner_id=o.owner_id and tr.status='active'
    left join private.entitlements sg on o.kind='slot_renewal_reminder' and sg.id=o.subject_id and sg.owner_id=o.owner_id
    left join private.entitlements tg on o.kind='term_ending_notice' and tg.id=o.subject_id and tg.owner_id=o.owner_id
    left join private.entitlements fc on o.kind='free_credit_reminder' and fc.id=o.subject_id and fc.owner_id=o.owner_id
      and fc.source='free_credit'
    left join private.privacy_requests sp on o.kind='staff_privacy_request' and sp.id=o.subject_id
    left join private.frontend_appeals sa on o.kind='staff_appeal' and sa.id=o.subject_id
    left join private.reports sr on o.kind='staff_report' and sr.id=o.subject_id
    left join private.frontend_business_checks sc on o.kind='sticker_renewal_reminder' and sc.id=o.subject_id
      and sc.owner_id=o.owner_id and sc.kind in('cipc','seen');
  return result;
end;
$function$;
alter function internal.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

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
    'bank_reference', t.bank_reference,
    'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'))
  from private.payments p left join private.invoices i on i.payment_id = p.id
    left join private.invoice_transfers t on t.payment_id = p.id
  where p.id = p_payment_id;
$function$;
alter function internal.get_payment_receipt(uuid) owner to postgres;
revoke all on function internal.get_payment_receipt(uuid) from public;
grant execute on function internal.get_payment_receipt(uuid) to service_role;

CREATE OR REPLACE FUNCTION internal.get_my_invoice(p_invoice_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices;
begin
  select * into inv from private.customer_invoices i
    where i.invoice_number = internal.customer_invoice_number(p_invoice_number) and i.account_id = actor;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  perform internal.price_draft_actor();
  return internal.customer_invoice_dto(inv, null);
end;
$function$;
alter function internal.get_my_invoice(text) owner to postgres;
revoke all on function internal.get_my_invoice(text) from public;
grant execute on function internal.get_my_invoice(text) to authenticated;

CREATE OR REPLACE FUNCTION internal.save_my_invoice_billing(p_invoice_number text, p_revision integer, p_buyer_name text, p_buyer_address text, p_buyer_registration_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; name text; address text; registration text;
begin
  name := regexp_replace(btrim(coalesce(p_buyer_name, '')), '\s+', ' ', 'g');
  address := regexp_replace(regexp_replace(btrim(coalesce(p_buyer_address, ''), E' \n\r\t'), E'\r\n?', E'\n', 'g'),
    E'[ \t]+', ' ', 'g');
  registration := nullif(regexp_replace(btrim(coalesce(p_buyer_registration_number, '')), '\s+', ' ', 'g'), '');
  if p_revision is null or not coalesce(internal.plain_text_valid(name, 2, 160, false), false)
      or not coalesce(internal.plain_text_valid(address, 5, 300, true), false)
      or (registration is not null and registration !~ '^[A-Za-z0-9][A-Za-z0-9 /.-]{1,39}$') then
    raise exception 'business or buyer name (2 to 160 characters), address (5 to 300) and a registration number of letters and digits required'
      using errcode='22023', detail='invoice_billing_invalid';
  end if;
  inv := internal.lock_my_issued_invoice(actor, p_invoice_number);
  if (inv.buyer_name, inv.buyer_address, inv.buyer_registration_number) is not distinct from (name, address, registration) then
    perform internal.price_draft_actor();
    return internal.customer_invoice_dto(inv, null) || jsonb_build_object('repeated', true);
  end if;
  if inv.revision <> p_revision then
    raise exception 'the invoice changed; reload it' using errcode='PT409', detail='invoice_revision_changed';
  end if;
  update private.customer_invoices set buyer_name = name, buyer_address = address,
      buyer_registration_number = registration, buyer_saved_at = statement_timestamp(), revision = revision + 1
    where id = inv.id returning * into inv;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.customer_invoice_dto(inv, null) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.save_my_invoice_billing(text,integer,text,text,text) owner to postgres;
revoke all on function internal.save_my_invoice_billing(text,integer,text,text,text) from public;
grant execute on function internal.save_my_invoice_billing(text,integer,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.start_invoice_payment(p_invoice_number text, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; plan private.plan_versions;
  latest private.payments; other private.payments; pay private.payments; fingerprint text; counted jsonb;
  attempts integer; consent jsonb := internal.customer_invoice_consent(); is_package boolean; add_package uuid;
begin
  if p_expected_total_cents is null then
    raise exception 'invoice total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023', detail='invoice_consent_required';
  end if;
  inv := internal.lock_my_issued_invoice(actor, p_invoice_number);
  if exists(select 1 from private.invoice_transfers t where t.customer_invoice_id = inv.id
      and internal.invoice_transfer_waiting(t)) then
    raise exception 'your bank transfer to this invoice is being checked; you do not need to pay again'
      using errcode='PT409', detail='invoice_transfer_waiting';
  end if;
  if inv.buyer_name is null then
    raise exception 'add your billing details before paying' using errcode='PT409', detail='invoice_billing_required';
  end if;
  if inv.total_cents <> p_expected_total_cents then
    raise exception 'the invoice total is % cents', inv.total_cents using errcode='PT428', detail='invoice_amount_mismatch';
  end if;
  -- An Individual slot invoice, or (P4e) a Multi-listing package invoice: the
  -- term must still be sold at the invoice's price; or (20261120045404) an
  -- added-slots invoice, at the price asked for (D1).
  add_package := internal.package_add_invoice_package(inv.id);
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id
    and ((v.retired_at is null
        and ((v.is_public and internal.individual_slot_plan(v.plan_code)) or internal.slot_package_plan(v.plan_code))
        and v.price_cents = inv.unit_price_cents)
      or (add_package is not null and internal.slot_package_plan(v.plan_code)));
  if not found then
    raise exception 'this invoice can no longer be paid online; ask for a new one'
      using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  is_package := internal.slot_package_plan(plan.plan_code);
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you pay' using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if is_package then
    -- A package is sold only while packages are on sale, and to an account
    -- with no package that has not ended (as the package checkout); this
    -- account, then its package, as the package checkout locks them. Added
    -- slots only while the package they were asked for still runs, with room.
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
    if add_package is not null then
      if not internal.slot_package_add_ok(actor, add_package, inv.slots) then
        raise exception 'the package these slots were for has ended; this invoice can no longer be paid'
          using errcode='PT409', detail='package_ended';
      end if;
    elsif internal.slot_package_open(actor) then
      raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
    end if;
  else
    -- E3 (20261114154823): while the person's Multi-listing package runs (until
    -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
    if internal.slot_package_blocks_individual(fingerprint, actor) then
      raise exception 'Individual slots cannot be sold while the person''s Multi-listing package runs'
        using errcode='PT409', detail='package_active';
    end if;
    -- One person at a time (every account of the identity), then this account,
    -- as the slot checkout does.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  end if;
  select p.* into latest from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
    where l.invoice_id = inv.id order by l.attempt desc limit 1 for update of p;
  if latest.id is not null then
    if latest.status in ('complete', 'refunded', 'chargeback') then
      raise exception 'this invoice is already paid' using errcode='PT409', detail='invoice_paid';
    end if;
    if latest.status = 'pending' and latest.checkout_url is not null
        and latest.checkout_expires_at > pg_catalog.clock_timestamp() then
      -- Its Ozow page is still open: the customer continues there.
      perform internal.price_draft_actor();
      return jsonb_build_object('payment_id', latest.id, 'merchant_reference', latest.merchant_reference,
        'amount_cents', latest.amount_cents::text, 'currency', latest.currency, 'status', latest.status,
        'slots', inv.slots, 'reused', true);
    end if;
    if internal.customer_invoice_attempt_live(latest) then
      raise exception 'your last payment of this invoice is still being checked; try again in a few minutes'
        using errcode='PT409', detail='invoice_payment_checking';
    end if;
    if latest.status <> 'pending' then
      latest := null; -- closed (expired, cancelled or failed): a new attempt
    end if;
  end if;
  -- Above the most Ozow accepts in one payment: the invoice is paid by bank
  -- transfer only (staff record it; a second staff member confirms it). After
  -- the "already paid" check, so a paid invoice still says it is paid.
  if inv.total_cents > internal.online_payment_max_cents() then
    raise exception 'this invoice is above the online payment limit of % cents; pay it by bank transfer',
      internal.online_payment_max_cents() using errcode='PT413', detail='online_payment_above_limit';
  end if;
  if latest.id is null then
    select count(*) into attempts from private.customer_invoice_payments l where l.invoice_id = inv.id;
    if attempts >= 20 then
      raise exception 'this invoice has had too many payment attempts; contact us'
        using errcode='PT429', detail='invoice_attempts_exhausted';
    end if;
    if is_package then
      -- Another package payment open (any term: one package order at a time,
      -- as the package checkout keeps it).
      for other in select p.* from private.payments p join private.plan_versions v on v.id = p.plan_version_id
          where p.owner_id = actor and p.status = 'pending' and p.target_post_id is null
            and internal.slot_package_plan(v.plan_code)
          order by p.created_at, p.id
          for update of p loop
        if other.checkout_url is not null or other.checkout_claim_until > pg_catalog.clock_timestamp() then
          raise exception 'finish or cancel your other open package payment first'
            using errcode='PT409', detail='invoice_checkout_open';
        end if;
        -- Never sent to Ozow, so it can never be paid: closed.
        update private.payments set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
          where id = other.id;
      end loop;
    else
      -- Another payment open for the same slot term (one per term at a time).
      select * into other from private.payments p
        where p.owner_id = actor and p.status = 'pending' and p.plan_version_id = plan.id and p.target_post_id is null
        for update;
      if found then
        if other.checkout_url is not null or other.checkout_claim_until > pg_catalog.clock_timestamp() then
          raise exception 'finish or cancel your other open payment for this slot first'
            using errcode='PT409', detail='invoice_checkout_open';
        end if;
        -- Never sent to Ozow, so it can never be paid: closed.
        update private.payments set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
          where id = other.id;
      end if;
    end if;
  end if;
  -- A package is not counted in the Individual slot limit.
  if not is_package then
    counted := internal.individual_slots_counted(fingerprint, actor, latest.id);
    if (counted->>'held')::integer + (counted->>'pending')::integer + inv.slots > internal.individual_slot_limit(fingerprint) then
      raise exception 'you can hold at most % Individual slots at a time', internal.individual_slot_limit(fingerprint)
        using errcode='PT429', detail='slot_limit_reached';
    end if;
  end if;
  if inv.cooling_off_consent_at is null then
    update private.customer_invoices set cooling_off_consent_at = statement_timestamp(),
        cooling_off_consent_version = consent->>'version'
      where id = inv.id returning * into inv;
  end if;
  if latest.id is not null then
    -- An attempt never sent to Ozow: the website sends it now.
    perform internal.price_draft_actor();
    return jsonb_build_object('payment_id', latest.id, 'merchant_reference', latest.merchant_reference,
      'amount_cents', latest.amount_cents::text, 'currency', latest.currency, 'status', latest.status,
      'slots', inv.slots, 'reused', true);
  end if;
  if is_package then
    -- One payment line holding every slot of the package (as the package
    -- checkout), so the Ozow notice delivers it as a package.
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot, merchant_reference)
      values (actor, 'plan', plan.id, inv.total_cents, plan.currency, jsonb_build_object('kind', 'plan',
          'category', 'slot_package', 'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
          'price_cents', plan.price_cents, 'slots', inv.slots, 'total_cents', inv.total_cents,
          'duration_days', plan.duration_days, 'slot_capacity', inv.slots,
          'activations_per_period', plan.activations_per_period * inv.slots,
          'activation_period_days', plan.activation_period_days,
          'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
          'addon_capabilities', to_jsonb(plan.addon_capabilities),
          'invoice_description', inv.description,
          'customer_invoice_id', inv.id, 'customer_invoice_number', inv.invoice_number, 'attempt', attempts + 1,
          'cooling_off_consent', jsonb_build_object('method', 'invoice', 'accepted_at', inv.cooling_off_consent_at,
            'version', inv.cooling_off_consent_version, 'wording', consent->>'wording',
            'terms_version', (select c.version from private.posting_terms_current c where c.singleton)))
          -- Added slots (20261120045404): delivered into the package asked for.
          || case when add_package is null then '{}'::jsonb else jsonb_build_object('category', 'slot_package_add',
            'package_id', add_package, 'unit_price_cents', inv.unit_price_cents) end,
        case when attempts = 0 then inv.invoice_number else inv.invoice_number || '-' || (attempts + 1)::text end)
      returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents, slot_count)
      values (pay.id, 1, plan.id, inv.total_cents, inv.slots);
  else
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot, merchant_reference)
      values (actor, 'plan', plan.id, inv.total_cents, plan.currency, jsonb_build_object('kind', 'plan',
          'category', 'individual', 'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
          'price_cents', plan.price_cents, 'slots', inv.slots, 'total_cents', inv.total_cents,
          'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
          'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
          'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
          'addon_capabilities', to_jsonb(plan.addon_capabilities),
          'invoice_description', inv.description,
          'customer_invoice_id', inv.id, 'customer_invoice_number', inv.invoice_number, 'attempt', attempts + 1,
          'cooling_off_consent', jsonb_build_object('method', 'invoice', 'accepted_at', inv.cooling_off_consent_at,
            'version', inv.cooling_off_consent_version, 'wording', consent->>'wording',
            'terms_version', (select c.version from private.posting_terms_current c where c.singleton))),
        case when attempts = 0 then inv.invoice_number else inv.invoice_number || '-' || (attempts + 1)::text end)
      returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents)
      select pay.id, n, plan.id, inv.unit_price_cents from pg_catalog.generate_series(1, inv.slots) n;
  end if;
  insert into private.customer_invoice_payments (payment_id, invoice_id, attempt) values (pay.id, inv.id, attempts + 1);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'slots', inv.slots, 'reused', false);
end;
$function$;
alter function internal.start_invoice_payment(text,bigint,boolean) owner to postgres;
revoke all on function internal.start_invoice_payment(text,bigint,boolean) from public;
grant execute on function internal.start_invoice_payment(text,bigint,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.get_my_invoice(p_invoice_number text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_invoice(p_invoice_number);
$function$;
alter function api.get_my_invoice(text) owner to postgres;
revoke all on function api.get_my_invoice(text) from public;
grant execute on function api.get_my_invoice(text) to authenticated;

CREATE OR REPLACE FUNCTION api.save_my_invoice_billing(p_invoice_number text, p_revision integer, p_buyer_name text, p_buyer_address text, p_buyer_registration_number text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_my_invoice_billing(p_invoice_number, p_revision, p_buyer_name, p_buyer_address,
    p_buyer_registration_number);
$function$;
alter function api.save_my_invoice_billing(text,integer,text,text,text) owner to postgres;
revoke all on function api.save_my_invoice_billing(text,integer,text,text,text) from public;
grant execute on function api.save_my_invoice_billing(text,integer,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.start_invoice_payment(p_invoice_number text, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_invoice_payment(p_invoice_number, p_expected_total_cents, p_cooling_off_consent);
$function$;
alter function api.start_invoice_payment(text,bigint,boolean) owner to postgres;
revoke all on function api.start_invoice_payment(text,bigint,boolean) from public;
grant execute on function api.start_invoice_payment(text,bigint,boolean) to authenticated;

drop function internal.get_my_invoice(text,text);
drop function internal.save_my_invoice_billing(text,integer,text,text,text,text);
drop function internal.start_invoice_payment(text,bigint,boolean,text);
drop function api.get_invoice_by_link(text);
drop function api.save_invoice_billing_by_link(text,integer,text,text,text);
drop function api.start_invoice_payment_by_link(text,bigint,boolean);
drop function api.prepare_invoice_email(uuid,text);
drop function internal.prepare_invoice_email(uuid,text);
drop function internal.customer_invoice_for_caller(text,text);

alter table private.outbox_events drop constraint outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind = any (array['payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update',
  'post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice',
  'free_credit_reminder','staff_privacy_request','staff_appeal','staff_report','sticker_renewal_reminder']));

drop index private.customer_invoices_pay_link_idx;
alter table private.customer_invoices drop column pay_link_hash;
commit;
