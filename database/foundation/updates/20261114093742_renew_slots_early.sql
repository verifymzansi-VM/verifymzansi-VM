-- Renew early and renewal reminders (roadmap P3). A member renews one or more
-- of their Individual slots before they end; each renewal is a new grant that
-- starts exactly when the slot's current period ends, so no day is lost and
-- the slot still counts once towards the person's limit. Three days before a
-- slot ends, the member is emailed once with a link to renew it.
--
-- Apply after 20261114041000_customer_invoice_pay_now.sql (it refuses with
-- 55000 unless the bodies it builds on or replaces are the reviewed ones).
-- Only adds: no API command, argument or grant is removed or changed. In one
-- transaction it:
--
-- 1. Links renewals to their slot. private.payment_lines gains
--    renews_entitlement_id: the slot (grant) a line renews, chosen at
--    checkout. private.entitlements gains renews_entitlement_id (the grant a
--    renewal follows) and slot_id (the slot's first grant), so every period
--    of one slot shares one slot id. At most one active renewal follows a
--    grant. Issued grants are never edited.
-- 2. New member command api.start_slot_renewal_checkout(p_entitlement_ids,
--    p_plan_id, p_expected_total_cents, p_cooling_off_consent): one payment
--    with one line per slot (the R10,000 online limit applies to the total,
--    PT413), for the member's own Individual slots that are still running
--    (another account's slot, an ended slot or one that is not an Individual
--    slot reads as not found, PT404 slot_unavailable), each slot once, from
--    14 days before the slot ends (internal.slot_renewal_window, the one
--    setting; earlier PT409 renewal_not_open), after an accepted ID review
--    (PT412), with the renewal's own cooling-off consent (22023; never the
--    new-slot "starts now" wording: the new days start on a later date, and
--    cancelling before they start means a full refund; the wording, its
--    version, its time and each slot's start date are kept in the payment's
--    snapshot), at the total the member was shown (PT428). A renewal never
--    adds a slot, but the slots renewed ahead (queued renewals, and renewals
--    in payments still open at Ozow) may not exceed the person's limit
--    (PT429), so a person over their limit (for example after a staff-raised
--    limit ended) renews at most as many slots as the limit. A pending
--    renewal of the same slots for the same term is reused. Only one order
--    per term can be pending (payments_one_pending_idx), so another order
--    for this term, or another renewal naming any of these slots, is
--    cancelled when it was never sent to Ozow, and otherwise returned (with
--    whether it is a renewal) so the member can continue, check or cancel it.
--    api.start_slot_checkout (full body) never reuses a renewal as an order
--    of new slots: it treats it as an order of another number of slots.
-- 3. Confirming a payment (internal.apply_provider_event, from the body of
--    20261114041000 with its invoice condition; internal.
--    activate_staff_paid_payment, full body) issues each line through the new
--    internal.issue_slot_line_entitlements: a new slot starts at payment; a
--    renewal starts when the slot's last active period ends (at payment if
--    that has already passed), as a new grant of the same slot. The person's
--    limit counts each slot once (internal.individual_slots_counted, full
--    body: distinct slots; open payments count only lines that would add a
--    slot), and a renewal whose slot ended or was refunded meanwhile counts
--    as a new slot.
-- 4. Posts stay live across the boundary. internal.post_funding (full body)
--    funds a post until the end of its slot's unbroken run of paid periods
--    (internal.slot_chain_end); a renewal moves the end date of the live and
--    paused posts in the slot to the end of the renewal at once
--    (internal.refresh_slot_chain_posts), and a renewal revoked before or
--    after it started (refund or chargeback) moves it back (trigger
--    entitlements_slot_chain_revoked). The 3-day grace after expiry then
--    starts only when the last renewal ends. When a period ends, the new
--    service sweep api.run_slot_renewals moves each post to the slot's next
--    period (its old activation released as entitlement_ended, the new one
--    marked continued). api.activate_post (full body) counts a slot's posts
--    over all its periods, so a post waiting to move still fills the slot,
--    and a continued activation is not a post going live (fair use).
-- 5. Renewal reminders. The same sweep queues one email (outbox kind
--    slot_renewal_reminder, keyed by the ending grant, so at most one per
--    slot end whatever the retries) for each ending grant the member can renew
--    (internal.slot_renewal_due: today Individual slots, interim ones
--    included; Multi-listing packages are added there later, G5) that ends
--    within 3 days with no renewal following it, while the account can buy.
--    A renewal refunded or charged back before it starts is withdrawn by the
--    existing one-slot reversal (its grant revoked, the posts' end moved back).
--    internal.claim_supported_notification_outbox (full body) hands it out
--    only to a confirmed, non-anonymous address and only while the slot still
--    ends unrenewed (otherwise it is finished without a send), with the end
--    date and whether more than one slot ends within 7 days (the email then
--    links to "Renew all"). It takes up to 21 kinds, each once (a repeated
--    kind is refused, as a list that was too long was before). The reminder
--    is a service notice about the member's own paid slot; the optional
--    marketing choices do not apply.
-- 6. New member read api.get_my_slots_v2(): api.get_my_slots plus, per slot,
--    whether it can be renewed, the end of its renewed periods and its
--    queued renewals; a period that ended because the next one started is
--    not listed again, a renewal waiting to start is listed (state
--    'upcoming') when the slot has no current period, and the number of
--    slots renewed ahead. api.get_my_slots is unchanged.
-- 7. The retention job (internal.retention_commerce, full body) keeps a grant
--    while a later renewal or a payment line still names it.
--
-- ORDER: apply this update before the pull request that uses it is merged (a
-- merge into main is deployed, and that release calls the new commands).
-- Earlier releases do not call them and keep working with it applied.
-- Read-only preflight: ../preflight/20261114093742_renew_slots_early.check.sql.
-- Rollback: ../rollback/20261114093742_renew_slots_early.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: the functions this update replaces are the earlier reviewed
-- bodies or this update's; the functions it calls are the reviewed ones; the
-- new columns are absent or exactly this update's.
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.individual_slots_counted(text,uuid,uuid)'),('internal.start_slot_checkout(uuid,integer,bigint,boolean)'),
      ('internal.apply_provider_event(jsonb)'),('internal.activate_staff_paid_payment(uuid,text)'),
      ('internal.activate_post(uuid)'),('internal.post_funding(uuid)'),
      ('internal.claim_supported_notification_outbox(text[],integer)'),('internal.retention_commerce(integer)')) v(sig)
  loop
    if shape not in (
        'internal.individual_slots_counted(text,uuid,uuid) 1444a238736eac1d4de7dc8a53526e9b',
        'internal.individual_slots_counted(text,uuid,uuid) 4213e64e4b2fb9f8062fe02277a28e69',
        'internal.start_slot_checkout(uuid,integer,bigint,boolean) dcbb5be85829b017a483c21b91c95602',
        'internal.start_slot_checkout(uuid,integer,bigint,boolean) 4ce514eae4c2fb3fd9b0a0ecc40ac498',
        'internal.apply_provider_event(jsonb) 8654ccb29310b12224a153f1327325e4',
        'internal.apply_provider_event(jsonb) cca841d0e0417233624c8afb7baba6e8',
        'internal.activate_staff_paid_payment(uuid,text) 355b954c1a0edc055a73485def59cd7c',
        'internal.activate_staff_paid_payment(uuid,text) 492170b6a48e1ccf1c4036e872860fce',
        'internal.activate_post(uuid) d9dd75c96dd1cce5b490eaafffe308be',
        'internal.activate_post(uuid) 6c4e0634477f324fbda2964a49668d81',
        'internal.post_funding(uuid) 48204868fb2cd5b34cd44acbab243a6f',
        'internal.post_funding(uuid) 2cff9aa43f38ded2f0f9d40fdbf6c285',
        'internal.claim_supported_notification_outbox(text[],integer) 13d3edc000634dfd830ffd1baa846381',
        'internal.claim_supported_notification_outbox(text[],integer) c7206aab3ac04b1f9d9b6ce2dc47bd0f',
        'internal.retention_commerce(integer) 20f9abaf7fcccd8b59974226a8ad0f3f',
        'internal.retention_commerce(integer) 06d7529db4898b7bb3b158d38a1d5929') then
      raise exception 'slot renewal precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.price_draft_actor()'),('internal.lock_evidence_subject(uuid)'),
      ('internal.individual_slot_identity(uuid)'),
      ('internal.individual_slot_limit(text)'),('internal.individual_slot_plan(text)'),
      ('internal.entitlement_for_post_eligible(uuid,uuid,uuid)'),('internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone)'),
      ('internal.customer_invoice_settled_elsewhere(uuid)'),('internal.addon_purchase_entitlement(uuid,uuid,text)'),
      ('internal.payment_invoice_vat(private.payments)'),('internal.payment_delivery_commission(uuid)'),
      ('internal.staff_actor(text)'),('internal.assert_staff_payment_actor(uuid,uuid)'),
      ('internal.plain_text_valid(text,integer,integer,boolean)'),('internal.retention_tax_year_due(timestamp with time zone)'),
      ('internal.reverse_payment_line(uuid,text,text,uuid)'),('internal.reverse_payment(uuid,text,text)'),
      ('internal.run_post_lifecycle(integer)')) v(sig)
  loop
    if shape not in (
        'internal.price_draft_actor() 1d70271a4447ba5d1377f3f64a6cf029',
        'internal.lock_evidence_subject(uuid) 3ef77cf81542607c0ba91f6687255f01',
        'internal.individual_slot_identity(uuid) 4e4552c83cb629e96f1300060eeff16b',
        'internal.individual_slot_limit(text) 90ecd5c02572cc9831468458f3ae0e2d',
        'internal.individual_slot_plan(text) c0c1d06dc52122641d02db6b1364be75',
        'internal.entitlement_for_post_eligible(uuid,uuid,uuid) ff74c8cfdd93037f14e29f53ac0896ff',
        'internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone) 0db72b1ee054a2d8dd1b946d73c58e41',
        'internal.customer_invoice_settled_elsewhere(uuid) eab13db8976c5bcde805288faec9591c',
        'internal.addon_purchase_entitlement(uuid,uuid,text) 2cd60895de8dad14dfe1d1f26ae83543',
        'internal.payment_invoice_vat(private.payments) 8ba4ca6c4ea0207abece5a9fdc57336e',
        'internal.payment_delivery_commission(uuid) 173b97b47147f69d097daba72def56d9',
        'internal.staff_actor(text) 269f0871f156f57c029cedcab72f6c3f',
        'internal.assert_staff_payment_actor(uuid,uuid) fe81cc39557206e06346fcf5e9f33bfd',
        'internal.plain_text_valid(text,integer,integer,boolean) b3654008b4427d60db398555fef16971',
        'internal.retention_tax_year_due(timestamp with time zone) 330c487132c054e1995261d5e92871b2',
        'internal.reverse_payment_line(uuid,text,text,uuid) 3f95168e1faacac2ca6f1431962c182c',
        'internal.reverse_payment(uuid,text,text) 66005adb9e06b17e689dbac47ce93d5a',
        'internal.run_post_lifecycle(integer) e902328043d024a4ba16e38eeabb1b73') then
      raise exception 'slot renewal precondition: % is not the reviewed body this update builds on', shape
        using errcode='55000';
    end if;
  end loop;
  if to_regclass('private.payment_lines') is null or to_regclass('private.customer_invoices') is null then
    raise exception 'slot renewal precondition: apply 20261113002421 and 20261114041000 first' using errcode='55000';
  end if;
  for shape in
    select v.rel||'.'||v.col||' '||coalesce((select pg_catalog.format_type(a.atttypid,a.atttypmod)
        ||case when a.attnotnull then '!' else '' end||coalesce(' default '||pg_catalog.pg_get_expr(d.adbin,d.adrelid),'')
      from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass(v.rel) and a.attname=v.col and not a.attisdropped),'absent')
    from (values ('private.entitlements','renews_entitlement_id'),('private.entitlements','slot_id'),
      ('private.payment_lines','renews_entitlement_id'),('private.post_activations','continued')) v(rel,col)
  loop
    if shape not in ('private.entitlements.renews_entitlement_id absent','private.entitlements.renews_entitlement_id uuid',
        'private.entitlements.slot_id absent','private.entitlements.slot_id uuid',
        'private.payment_lines.renews_entitlement_id absent','private.payment_lines.renews_entitlement_id uuid',
        'private.post_activations.continued absent','private.post_activations.continued boolean! default false') then
      raise exception 'slot renewal column drift: %', shape using errcode='55000';
    end if;
  end loop;
end$$;

-- 1. Renewal links.
alter table private.entitlements add column if not exists renews_entitlement_id uuid;
alter table private.entitlements add column if not exists slot_id uuid;
alter table private.payment_lines add column if not exists renews_entitlement_id uuid;
alter table private.post_activations add column if not exists continued boolean not null default false;
do $$begin
  if not exists(select 1 from pg_catalog.pg_constraint where conname='entitlements_renews_entitlement_id_fkey'
      and conrelid='private.entitlements'::regclass) then
    alter table private.entitlements add constraint entitlements_renews_entitlement_id_fkey
      foreign key (renews_entitlement_id) references private.entitlements (id) on delete restrict;
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conname='entitlements_slot_id_fkey'
      and conrelid='private.entitlements'::regclass) then
    alter table private.entitlements add constraint entitlements_slot_id_fkey
      foreign key (slot_id) references private.entitlements (id) on delete restrict;
  end if;
  -- A renewal is a paid slot line that names both the grant it follows and
  -- the slot's first grant.
  if not exists(select 1 from pg_catalog.pg_constraint where conname='entitlements_renewal_link'
      and conrelid='private.entitlements'::regclass) then
    alter table private.entitlements add constraint entitlements_renewal_link
      check ((renews_entitlement_id is null) = (slot_id is null)
        and (renews_entitlement_id is null or payment_line_id is not null));
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conname='payment_lines_renews_entitlement_id_fkey'
      and conrelid='private.payment_lines'::regclass) then
    alter table private.payment_lines add constraint payment_lines_renews_entitlement_id_fkey
      foreign key (renews_entitlement_id) references private.entitlements (id) on delete restrict;
  end if;
end$$;
create unique index if not exists entitlements_renews_active_idx on private.entitlements (renews_entitlement_id)
  where renews_entitlement_id is not null and status = 'active';
create index if not exists entitlements_renews_entitlement_idx on private.entitlements (renews_entitlement_id)
  where renews_entitlement_id is not null;
create index if not exists entitlements_slot_idx on private.entitlements (slot_id) where slot_id is not null;
create index if not exists payment_lines_renews_entitlement_idx on private.payment_lines (renews_entitlement_id)
  where renews_entitlement_id is not null;

-- 5. The reminder's outbox kind.
alter table private.outbox_events drop constraint if exists outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind = any (array['payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update',
  'post_sold','post_kept','verification_returned','slot_renewal_reminder']));

-- The accounts behind one person: the account itself and every account that
-- has had an accepted ID review with the same fingerprint, except accounts
-- that lost access for good (closed, deleted, or under an approved permanent
-- ban that was not lifted). An account blocked for a while keeps counting.
CREATE OR REPLACE FUNCTION internal.individual_slot_owners(p_identity text, p_owner uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select o.id from (
    select p_owner as id
    union
    select f.owner_id from private.accepted_identity_facts f where p_identity is not null and f.identity_hmac=p_identity
  ) o
  where exists(select 1 from auth.users u where u.id=o.id and u.deleted_at is null)
    and not exists(select 1 from private.account_closures c where c.user_id=o.id)
    and not exists(select 1 from private.decisions d
      join private.evidence_cases c on c.id=d.case_id
      left join private.frontend_account_restrictions x on x.decision_id=d.id and not x.emergency
      where c.subject_id=o.id and d.status='approved' and d.action='restrict_account'
        and d.scope_kind in ('native','report_ban') and x.lifted_at is null);
$function$;
alter function internal.individual_slot_owners(text,uuid) owner to postgres;
revoke all on function internal.individual_slot_owners(text,uuid) from public, anon, authenticated, service_role;

-- How long before a slot ends it can be renewed (the one setting for the
-- renewal window): a renewal paid before it starts can be cancelled for a full
-- refund until it starts, so renewals are kept close to the slot's end.
CREATE OR REPLACE FUNCTION internal.slot_renewal_window()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select interval '14 days';
$function$;
alter function internal.slot_renewal_window() owner to postgres;
revoke all on function internal.slot_renewal_window() from public, anon, authenticated, service_role;

-- When the slot of this grant ends: the latest end of its active periods.
CREATE OR REPLACE FUNCTION internal.slot_chain_last_end(p_entitlement uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select max(e.ends_at) from private.entitlements t
    join private.entitlements e on e.id=coalesce(t.slot_id,t.id) or e.slot_id=coalesce(t.slot_id,t.id)
  where t.id=p_entitlement and e.status='active';
$function$;
alter function internal.slot_chain_last_end(uuid) owner to postgres;
revoke all on function internal.slot_chain_last_end(uuid) from public, anon, authenticated, service_role;

-- Whether the slot of this grant is still held: one of its periods is active
-- and has not ended.
CREATE OR REPLACE FUNCTION internal.slot_chain_held(p_entitlement uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.entitlements t
    join private.entitlements e on e.id=coalesce(t.slot_id,t.id) or e.slot_id=coalesce(t.slot_id,t.id)
    where t.id=p_entitlement and e.status='active' and e.ends_at>clock_timestamp());
$function$;
alter function internal.slot_chain_held(uuid) owner to postgres;
revoke all on function internal.slot_chain_held(uuid) from public, anon, authenticated, service_role;

-- The end of the unbroken run of paid periods from this grant: its own end,
-- or the end of the last active renewal that follows on from it (a renewal
-- starts when the period before it ends).
CREATE OR REPLACE FUNCTION internal.slot_chain_end(p_entitlement uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with recursive run(id, ends_at, chain) as (
    select e.id, e.ends_at, coalesce(e.slot_id, e.id) from private.entitlements e where e.id=p_entitlement
    union all
    select n.id, n.ends_at, run.chain from run join private.entitlements n
      on n.slot_id=run.chain and n.status='active' and n.starts_at<=run.ends_at and n.ends_at>run.ends_at
  )
  select max(run.ends_at) from run;
$function$;
alter function internal.slot_chain_end(uuid) owner to postgres;
revoke all on function internal.slot_chain_end(uuid) from public, anon, authenticated, service_role;

-- An ending grant this account can renew, due a renewal reminder: today an
-- Individual slot period (staff-raised "interim" slots included) that is
-- active, paid (complete payment, open line), not yet ended, with no active
-- period of the same slot covering its end, of an account that can still buy.
-- Reminders are queued and sent only while this holds; Multi-listing packages
-- (roadmap P4, G5) add their grants here.
CREATE OR REPLACE FUNCTION internal.slot_renewal_due(p_entitlement uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.entitlements g
      join private.payment_lines l on l.id=g.payment_line_id and l.payment_id=g.payment_id
      join private.plan_versions v on v.id=l.plan_version_id
      join private.payments pay on pay.id=g.payment_id
    where g.id=p_entitlement and g.owner_id=p_owner and g.status='active' and g.source='retail_paid'
      and internal.individual_slot_plan(v.plan_code) and l.status='open'
      and pay.status='complete' and pay.owner_id=g.owner_id
      and g.starts_at<=clock_timestamp() and g.ends_at>clock_timestamp()
      and not exists(select 1 from private.entitlements n where n.slot_id=coalesce(g.slot_id,g.id)
        and n.id<>g.id and n.status='active' and n.starts_at<=g.ends_at and n.ends_at>g.ends_at)
      and exists(select 1 from private.current_account_access a where a.id=g.owner_id));
$function$;
alter function internal.slot_renewal_due(uuid,uuid) owner to postgres;
revoke all on function internal.slot_renewal_due(uuid,uuid) from public, anon, authenticated, service_role;

-- 3. Counting: each Individual slot once, however many periods it has.
CREATE OR REPLACE FUNCTION internal.individual_slots_counted(p_identity text, p_owner uuid, p_exclude uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with owners as (select internal.individual_slot_owners(p_identity, p_owner) as id)
  select jsonb_build_object(
    -- Slots held: each slot once, whatever renewals it has queued.
    'held', (select count(distinct coalesce(e.slot_id, e.id)) from private.entitlements e
        join private.payment_lines l on l.id=e.payment_line_id
        join private.plan_versions v on v.id=l.plan_version_id
      where e.owner_id in (select id from owners) and e.source='retail_paid' and e.status='active'
        and e.ends_at>clock_timestamp() and internal.individual_slot_plan(v.plan_code)),
    -- Slots in payments still open at Ozow that would add a slot: a new slot,
    -- or a renewal of a slot that is no longer held.
    'pending', (select count(*) from private.payment_lines l
        join private.payments p on p.id=l.payment_id
        join private.plan_versions v on v.id=l.plan_version_id
      where p.owner_id in (select id from owners) and p.status='pending' and p.id is distinct from p_exclude
        and internal.individual_slot_plan(v.plan_code)
        and (p.checkout_expires_at>clock_timestamp() or p.checkout_claim_until>clock_timestamp()
          or (p.checkout_url is null and p.created_at>clock_timestamp()-interval '30 minutes'))
        and (l.renews_entitlement_id is null or not internal.slot_chain_held(l.renews_entitlement_id))));
$function$;
alter function internal.individual_slots_counted(text,uuid,uuid) owner to postgres;
revoke all on function internal.individual_slots_counted(text,uuid,uuid) from public, anon, authenticated, service_role;

-- Slots renewed ahead: held slots with a renewal queued, or with a renewal in
-- a payment still open at Ozow (other than p_exclude), together with the
-- slots p_chains would renew. A renewal never adds a slot, but at most the
-- person's limit of slots may be renewed ahead.
CREATE OR REPLACE FUNCTION internal.individual_slots_extended(p_identity text, p_owner uuid, p_exclude uuid, p_chains uuid[])
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with owners as (select internal.individual_slot_owners(p_identity, p_owner) as id),
  chains as (
    select e.slot_id as chain from private.entitlements e
      join private.payment_lines l on l.id=e.payment_line_id
      join private.plan_versions v on v.id=l.plan_version_id
    where e.owner_id in (select id from owners) and e.source='retail_paid' and e.status='active'
      and e.slot_id is not null and e.starts_at>clock_timestamp() and internal.individual_slot_plan(v.plan_code)
    union
    select coalesce(t.slot_id, t.id) from private.payment_lines l
      join private.payments p on p.id=l.payment_id
      join private.entitlements t on t.id=l.renews_entitlement_id
    where p.owner_id in (select id from owners) and p.status='pending' and p.id is distinct from p_exclude
      and (p.checkout_expires_at>clock_timestamp() or p.checkout_claim_until>clock_timestamp()
        or (p.checkout_url is null and p.created_at>clock_timestamp()-interval '30 minutes'))
      and internal.slot_chain_held(t.id)
    union
    select c from unnest(coalesce(p_chains, '{}'::uuid[])) c where c is not null
  )
  select count(*)::integer from chains;
$function$;
alter function internal.individual_slots_extended(text,uuid,uuid,uuid[]) owner to postgres;
revoke all on function internal.individual_slots_extended(text,uuid,uuid,uuid[]) from public, anon, authenticated, service_role;

-- The open lines of a payment that would add a slot (a new slot, or a
-- renewal of a slot that is no longer held), and the held slots its other
-- lines renew.
CREATE OR REPLACE FUNCTION internal.slot_lines_adding(p_payment_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select count(*)::integer from private.payment_lines l
  where l.payment_id=p_payment_id and l.status='open'
    and (l.renews_entitlement_id is null or not internal.slot_chain_held(l.renews_entitlement_id));
$function$;
alter function internal.slot_lines_adding(uuid) owner to postgres;
revoke all on function internal.slot_lines_adding(uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.slot_lines_renewing(p_payment_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(array_agg(distinct coalesce(t.slot_id, t.id)), '{}'::uuid[]) from private.payment_lines l
    join private.entitlements t on t.id=l.renews_entitlement_id
  where l.payment_id=p_payment_id and l.status='open' and internal.slot_chain_held(t.id);
$function$;
alter function internal.slot_lines_renewing(uuid) owner to postgres;
revoke all on function internal.slot_lines_renewing(uuid) from public, anon, authenticated, service_role;

-- 4. A post shows until the end of its slot's unbroken run of paid periods.
CREATE OR REPLACE FUNCTION internal.refresh_slot_chain_posts(p_chain uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare changed integer;
begin
  -- Live and paused posts in any active period of the slot: a renewal moves
  -- their end to the end of the renewal; a revoked renewal moves it back. A
  -- post under a staff hold keeps its state (the hand-over sets it again).
  with due as (
    select p.id, internal.slot_chain_end(a.entitlement_id) as until
    from private.post_activations a
      join private.entitlements e on e.id=a.entitlement_id
      join private.posts p on p.id=a.post_id
    where a.released_at is null and (e.id=p_chain or e.slot_id=p_chain) and e.status='active'
      and p.kind<>'event' and p.edit_of is null and p.status in ('live','paused')
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
  ), moved as (
    update private.posts p set visible_until=d.until from due d
    where p.id=d.id and d.until is not null and p.visible_until is distinct from d.until
    returning p.id, p.visible_until
  )
  update private.post_search_documents s set visible_until=m.visible_until from moved m where s.post_id=m.id;
  get diagnostics changed=row_count;
  return changed;
end;
$function$;
alter function internal.refresh_slot_chain_posts(uuid) owner to postgres;
revoke all on function internal.refresh_slot_chain_posts(uuid) from public, anon, authenticated, service_role;

-- A renewal (or any period of a renewed slot) revoked by a refund or a
-- chargeback: the slot's other posts end when its remaining unbroken run of
-- periods ends. The reversal itself ends the posts of the revoked period.
CREATE OR REPLACE FUNCTION internal.slot_grant_revoked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.status='revoked' and old.status<>'revoked'
    and (new.slot_id is not null or exists(select 1 from private.entitlements r where r.slot_id=new.id)) then
    perform internal.refresh_slot_chain_posts(coalesce(new.slot_id, new.id));
  end if;
  return null;
end;
$function$;
alter function internal.slot_grant_revoked() owner to postgres;
revoke all on function internal.slot_grant_revoked() from public, anon, authenticated, service_role;
drop trigger if exists entitlements_slot_chain_revoked on private.entitlements;
create trigger entitlements_slot_chain_revoked after update of status on private.entitlements
  for each row execute function internal.slot_grant_revoked();

-- 3. One grant per open line of a confirmed slot payment, in line order. A
-- new slot starts now. A renewal starts when the slot's last active period
-- ends (now, if that has passed), as a new grant of the same slot, and the
-- slot's posts then show until the renewal ends. Called with the payment
-- owner's subject lock held.
CREATE OR REPLACE FUNCTION internal.issue_slot_line_entitlements(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; snap jsonb; line private.payment_lines; target private.entitlements;
  tail private.entitlements; chain uuid; starts timestamptz; made integer := 0;
begin
  select * into pay from private.payments p where p.id=p_payment_id;
  snap := pay.snapshot;
  for line in select * from private.payment_lines l where l.payment_id=pay.id and l.status='open' order by l.line_number loop
    starts := statement_timestamp();
    chain := null;
    tail := null;
    if line.renews_entitlement_id is not null then
      select * into target from private.entitlements e where e.id=line.renews_entitlement_id;
      if target.owner_id is distinct from pay.owner_id then
        raise exception 'a renewal must renew a slot of the account that paid' using errcode='23514';
      end if;
      chain := coalesce(target.slot_id, target.id);
      perform 1 from private.entitlements e where e.id=chain or e.slot_id=chain order by e.id for update;
      select * into tail from private.entitlements e where (e.id=chain or e.slot_id=chain) and e.status='active'
        order by e.ends_at desc, e.id desc limit 1;
      if tail.id is not null then
        starts := greatest(tail.ends_at, statement_timestamp());
      end if;
    end if;
    insert into private.entitlements (owner_id, source, area, payment_id, payment_line_id, slot_capacity,
      activations_per_period, activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities,
      renews_entitlement_id, slot_id)
    values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, line.id, (snap->>'slot_capacity')::integer,
      (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
      (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, starts,
      starts + make_interval(days => (snap->>'duration_days')::integer),
      array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))),
      case when chain is not null then coalesce(tail.id, target.id) end, chain);
    made := made + 1;
    if chain is not null then
      perform internal.refresh_slot_chain_posts(chain);
    end if;
  end loop;
  return made;
end;
$function$;
alter function internal.issue_slot_line_entitlements(uuid) owner to postgres;
revoke all on function internal.issue_slot_line_entitlements(uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.post_funding(p_post_id uuid)
 RETURNS TABLE(funded_until timestamp with time zone, max_photos integer, max_videos integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select e.ends_at, 10, 1
  from private.posts p join private.event_details e on e.post_id = p.id
  where p.id = p_post_id and p.kind = 'event'
  union all
  -- A paid slot funds its post until the end of the slot's unbroken run of
  -- paid periods (a renewal follows on from the period before it).
  select internal.slot_chain_end(e.id), e.max_photos, e.max_videos
  from private.posts p
  join private.post_activations a on a.post_id = p.id and a.released_at is null and a.owner_id = p.owner_id
  join private.entitlements e on e.id = a.entitlement_id
  where p.id = p_post_id and p.kind <> 'event'
    and internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
    and (e.area is null or e.area = p.area)
    and (e.owner_id = p.owner_id or exists (select 1 from private.entitlement_members m
      where m.entitlement_id = e.id and m.member_id = p.owner_id))
    and exists (select 1 from private.current_account_access u where u.id = e.owner_id)
    and (e.source <> 'retail_paid' or exists (select 1 from private.payments pay
      where pay.id = e.payment_id and pay.owner_id = e.owner_id and pay.status = 'complete'));
$function$;
alter function internal.post_funding(uuid) owner to postgres;
revoke all on function internal.post_funding(uuid) from public;

CREATE OR REPLACE FUNCTION internal.activate_post(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  current_activation private.post_activations;
  ent private.entitlements;
  used integer;
  any_usable boolean := false;
begin
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  select * into current_activation from private.post_activations a where a.post_id = post.id and a.released_at is null;
  if found then
    select * into ent from private.entitlements e where e.id = current_activation.entitlement_id for update;
    if internal.entitlement_for_post_eligible(ent.id,post.id,actor) then
      perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('activation_id', current_activation.id, 'entitlement_id', ent.id, 'reused', true);
    end if;
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'entitlement_ended'
      where id = current_activation.id;
  end if;
  for ent in
    select e.* from private.entitlements e
    where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
      and (e.area is null or e.area = post.area)
      and (e.owner_id = actor or exists (select 1 from private.entitlement_members m
        where m.entitlement_id = e.id and m.member_id = actor))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'))
    order by e.ends_at, e.id
    for update
  loop
    -- Cursor predicates may predate a row wait; re-read all authority and wall time.
    continue when not internal.entitlement_for_post_eligible(ent.id,post.id,actor);
    any_usable := true;
    -- A slot's posts over all its periods: a post still in the period that
    -- just ended (waiting to move to this one) fills the slot.
    select count(*) into used from private.post_activations a where a.released_at is null
      and a.entitlement_id in (select c.id from private.entitlements c
        where c.id = coalesce(ent.slot_id, ent.id) or c.slot_id = coalesce(ent.slot_id, ent.id));
    continue when used >= ent.slot_capacity;
    if ent.activations_per_period is not null then
      -- Posts going live in the period: a new post and an ended post brought
      -- back each count; a submission that review rejected does not, nor a
      -- post moved on into a renewed period.
      select count(*) into used from private.post_activations a where a.entitlement_id = ent.id
        and a.activated_at > statement_timestamp() - make_interval(days => ent.activation_period_days)
        and a.release_reason is distinct from 'moderation' and not a.continued;
      continue when used >= ent.activations_per_period;
    end if;
    insert into private.post_activations (post_id, entitlement_id, owner_id) values (post.id, ent.id, actor)
      returning * into current_activation;
    perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('activation_id', current_activation.id, 'entitlement_id', ent.id, 'reused', false);
  end loop;
  if any_usable then
    raise exception 'all posting capacity is in use' using errcode = 'PT409';
  end if;
  raise exception 'no active plan covers this post' using errcode = 'PT402';
end;
$function$;
alter function internal.activate_post(uuid) owner to postgres;
revoke all on function internal.activate_post(uuid) from public;
grant execute on function internal.activate_post(uuid) to authenticated;

-- 2. The new-slot checkout never reuses a renewal as an order of new slots.
CREATE OR REPLACE FUNCTION internal.start_slot_checkout(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  plan private.plan_versions;
  pay private.payments;
  fingerprint text;
  counted jsonb;
  slot_limit integer;
  total bigint;
  lines integer;
  renewal boolean;
begin
  if p_plan_id is null or p_slots is null or p_slots not between 1 and 25 or p_expected_total_cents is null then
    raise exception 'slot plan, number of slots and total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023';
  end if;
  perform internal.lock_evidence_subject(actor);
  select * into plan from private.plan_versions v
    where v.id=p_plan_id and v.retired_at is null and v.is_public and internal.individual_slot_plan(v.plan_code);
  if not found then raise exception 'this slot is not on sale' using errcode='22023'; end if;
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you buy a slot' using errcode='PT412';
  end if;
  total := plan.price_cents * p_slots;
  if total > 1000000 then
    raise exception 'orders above R10,000 are paid by invoice' using errcode='PT413';
  end if;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  -- One person at a time (every account of the identity), then this account.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  select * into pay from private.payments p
    where p.owner_id=actor and p.status='pending' and p.plan_version_id=plan.id and p.target_post_id is null
    for update;
  if found then
    select count(*) into lines from private.payment_lines l where l.payment_id=pay.id;
    renewal := exists(select 1 from private.payment_lines l where l.payment_id=pay.id and l.renews_entitlement_id is not null);
    -- A renewal (api.start_slot_renewal_checkout) is never reused as an order
    -- of new slots: like an order of another number of slots it is continued,
    -- checked or cancelled first.
    if lines <> p_slots or renewal then
      if pay.checkout_url is not null then
        -- Open at Ozow for another order: the member continues, checks or
        -- cancels it first.
        perform internal.price_draft_actor();
        return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
          'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
          'slots', lines, 'renewal', renewal, 'reused', true);
      elsif pay.checkout_claim_until > clock_timestamp() then
        raise exception 'checkout is being created' using errcode='PT409';
      end if;
      -- Never sent to Ozow, so it can never be paid: replaced.
      update private.payments set status='cancelled', status_changed_at=clock_timestamp() where id=pay.id;
      pay := null;
    end if;
  end if;
  counted := internal.individual_slots_counted(fingerprint, actor, pay.id);
  slot_limit := internal.individual_slot_limit(fingerprint);
  if (counted->>'held')::integer + (counted->>'pending')::integer + p_slots > slot_limit then
    raise exception 'you can hold at most % Individual slots at a time', slot_limit using errcode='PT429';
  end if;
  if pay.id is null then
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot)
    values (actor, 'plan', plan.id, total, plan.currency, jsonb_build_object('kind', 'plan', 'category', 'individual',
        'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
        'price_cents', plan.price_cents, 'slots', p_slots, 'total_cents', total,
        'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
        'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', case when p_slots = 1 then plan.label else p_slots::text || ' × ' || plan.label end,
        'cooling_off_consent', jsonb_build_object('accepted_at', statement_timestamp(),
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton),
          'wording', 'My slot starts now; the 7-day cooling-off does not apply because the service starts immediately')))
    returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents)
      select pay.id, n, plan.id, plan.price_cents from pg_catalog.generate_series(1, p_slots) n;
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'slots', p_slots, 'reused', pay.created_at < statement_timestamp());
end;
$function$;
alter function internal.start_slot_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function internal.start_slot_checkout(uuid,integer,bigint,boolean) from public;
grant execute on function internal.start_slot_checkout(uuid,integer,bigint,boolean) to authenticated;

-- 2. Renewing slots early.
CREATE OR REPLACE FUNCTION internal.start_slot_renewal_checkout(p_entitlement_ids uuid[], p_plan_id uuid,
  p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  plan private.plan_versions;
  pay private.payments;
  open_pay private.payments;
  fingerprint text;
  slots integer;
  chains uuid[];
  open_chains uuid[];
  total bigint;
  slot_limit integer;
  lines integer;
begin
  if p_entitlement_ids is null or coalesce(array_ndims(p_entitlement_ids), 0) <> 1
    or cardinality(p_entitlement_ids) not between 1 and 25 or array_position(p_entitlement_ids, null) is not null
    or p_plan_id is null or p_expected_total_cents is null then
    raise exception 'slots to renew, term and total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023';
  end if;
  slots := cardinality(p_entitlement_ids);
  perform internal.lock_evidence_subject(actor);
  select * into plan from private.plan_versions v
    where v.id=p_plan_id and v.retired_at is null and v.is_public and internal.individual_slot_plan(v.plan_code);
  if not found then raise exception 'this slot is not on sale' using errcode='22023'; end if;
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you renew a slot' using errcode='PT412';
  end if;
  -- Each id must be a period of one of this account's Individual slots that
  -- is still running; anything else (another account's slot included) reads
  -- as not found.
  if exists(select 1 from unnest(p_entitlement_ids) x(id) where not exists(
      select 1 from private.entitlements e
        join private.payment_lines l on l.id=e.payment_line_id and l.payment_id=e.payment_id
        join private.plan_versions v on v.id=l.plan_version_id
        join private.payments p on p.id=e.payment_id
      where e.id=x.id and e.owner_id=actor and e.source='retail_paid' and e.status='active' and l.status='open'
        and p.status='complete' and p.owner_id=actor and internal.individual_slot_plan(v.plan_code)
        and internal.slot_chain_held(e.id))) then
    raise exception 'slot not found' using errcode='PT404', detail='slot_unavailable';
  end if;
  select array_agg(distinct coalesce(e.slot_id, e.id) order by coalesce(e.slot_id, e.id)) into chains
    from private.entitlements e where e.id = any(p_entitlement_ids);
  if cardinality(chains) <> slots then
    raise exception 'each slot can be renewed once per order' using errcode='22023';
  end if;
  -- Renewing opens 14 days (internal.slot_renewal_window) before the slot ends.
  if exists(select 1 from unnest(p_entitlement_ids) x(id)
      where internal.slot_chain_last_end(x.id) > clock_timestamp() + internal.slot_renewal_window()) then
    raise exception 'a slot can be renewed from % before it ends', internal.slot_renewal_window()
      using errcode='PT409', detail='renewal_not_open';
  end if;
  total := plan.price_cents * slots;
  if total > 1000000 then
    raise exception 'orders above R10,000 are paid by invoice' using errcode='PT413';
  end if;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  -- Pending orders: a renewal of the same slots for the same term is
  -- continued. Another order for this term (one order per term can be open)
  -- or another renewal naming any of these slots is cancelled when it was
  -- never sent to Ozow, and otherwise returned (continue, check or cancel it
  -- first).
  for open_pay in select p.* from private.payments p
      where p.owner_id=actor and p.status='pending' and p.target_post_id is null
        and (p.plan_version_id = plan.id
          or exists(select 1 from private.payment_lines l where l.payment_id=p.id and l.renews_entitlement_id is not null))
      order by p.created_at, p.id for update loop
    select array_agg(distinct coalesce(t.slot_id, t.id) order by coalesce(t.slot_id, t.id)) into open_chains
      from private.payment_lines l join private.entitlements t on t.id=l.renews_entitlement_id
      where l.payment_id=open_pay.id;
    if open_pay.plan_version_id = plan.id and open_chains = chains then
      pay := open_pay;
    elsif open_pay.plan_version_id = plan.id or open_chains && chains then
      if open_pay.checkout_url is not null then
        select count(*) into lines from private.payment_lines l where l.payment_id=open_pay.id;
        perform internal.price_draft_actor();
        return jsonb_build_object('payment_id', open_pay.id, 'merchant_reference', open_pay.merchant_reference,
          'amount_cents', open_pay.amount_cents::text, 'currency', open_pay.currency, 'status', open_pay.status,
          'slots', lines, 'renewal', open_chains is not null, 'reused', true);
      elsif open_pay.checkout_claim_until > clock_timestamp() then
        raise exception 'checkout is being created' using errcode='PT409';
      end if;
      update private.payments set status='cancelled', status_changed_at=clock_timestamp() where id=open_pay.id;
    end if;
  end loop;
  slot_limit := internal.individual_slot_limit(fingerprint);
  if internal.individual_slots_extended(fingerprint, actor, pay.id, chains) > slot_limit then
    raise exception 'you can renew at most % Individual slots ahead', slot_limit using errcode='PT429';
  end if;
  if pay.id is null then
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot)
    values (actor, 'plan', plan.id, total, plan.currency, jsonb_build_object('kind', 'plan', 'category', 'individual',
        'renewal', true, 'code', plan.plan_code, 'version', plan.version, 'label', 'Renewal: ' || plan.label,
        'area', plan.area, 'price_cents', plan.price_cents, 'slots', slots, 'total_cents', total,
        'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
        'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', 'Renewal: ' || case when slots = 1 then plan.label else slots::text || ' × ' || plan.label end,
        -- The start date each slot's new days were shown with (its end now).
        'renewal_starts', (select jsonb_agg(jsonb_build_object('entitlement_id', x.id,
            'starts_at', internal.slot_chain_last_end(x.id)) order by x.n)
          from unnest(p_entitlement_ids) with ordinality x(id, n)),
        'cooling_off_consent', jsonb_build_object('accepted_at', statement_timestamp(),
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton),
          'wording_version', 'renewal-cooling-off-v1',
          'wording', 'My new days start on the date shown for each slot, when its current days end. If I cancel before they start, I get a full refund; once they start, the 7-day cooling-off no longer applies')))
    returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents, renews_entitlement_id)
      select pay.id, x.n, plan.id, plan.price_cents, x.id
      from unnest(p_entitlement_ids) with ordinality x(id, n);
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'slots', slots, 'renewal', true, 'reused', pay.created_at < statement_timestamp());
end;
$function$;
alter function internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) owner to postgres;
revoke all on function internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.start_slot_renewal_checkout(p_entitlement_ids uuid[], p_plan_id uuid,
  p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_slot_renewal_checkout(p_entitlement_ids, p_plan_id, p_expected_total_cents, p_cooling_off_consent);
$function$;
alter function api.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) owner to postgres;
revoke all on function api.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) from public, anon, authenticated, service_role;
grant execute on function api.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) to authenticated;

-- 3. Confirmation (the body of 20261114041000 with its invoice condition):
-- slot lines are delivered through internal.issue_slot_line_entitlements, and
-- the limit counts each slot once (a renewal of a held slot adds none).
CREATE OR REPLACE FUNCTION internal.apply_provider_event(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  ev jsonb := p_event;
  pay private.payments;
  snap jsonb;
  outcome text;
  window_start timestamptz;
  vat bigint;
  payment_owner uuid;
  prior private.provider_events;
  target private.posts;
  fulfillable boolean;
  line_count integer := 0;
  fingerprint text;
  renewing uuid[];
begin
  if jsonb_typeof(ev) <> 'object' or not (array(select jsonb_object_keys(ev)) <@ array['payload_sha256',
      'merchant_reference', 'provider_request_id', 'provider_transaction_id', 'status', 'amount_cents', 'currency'])
    or ev->>'payload_sha256' !~ '^[a-f0-9]{64}$' or jsonb_typeof(ev->'amount_cents') <> 'number'
    or ev->>'status' not in ('complete', 'cancelled', 'error', 'abandoned', 'pending')
    or nullif(ev->>'merchant_reference', '') is null or nullif(ev->>'provider_request_id', '') is null then
    raise exception 'invalid provider event' using errcode = '22023';
  end if;
  -- Serialize identical payloads, including unknown references. Then acquire
  -- the immutable owner's fence before any payment/post row lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('provider_event:'||(ev->>'payload_sha256'),707));
  select * into prior from private.provider_events e where e.provider='ozow' and e.payload_sha256=ev->>'payload_sha256';
  if found then
    return jsonb_build_object('outcome','duplicate_event','original_outcome',prior.outcome,'payment_id',prior.payment_id);
  end if;
  select p.owner_id into payment_owner from private.payments p where p.merchant_reference=ev->>'merchant_reference';
  if payment_owner is not null then perform internal.lock_evidence_subject(payment_owner); end if;
  select * into pay from private.payments p where p.merchant_reference = ev->>'merchant_reference' for update;
  if not found then
    outcome := 'unknown_reference';
  elsif pay.provider_request_id is distinct from ev->>'provider_request_id' then
    outcome := 'request_mismatch';
  elsif (ev->>'amount_cents')::bigint is distinct from pay.amount_cents or ev->>'currency' is distinct from pay.currency then
    outcome := 'amount_mismatch';
  elsif pay.status = 'complete' then
    outcome := case when ev->>'status' <> 'complete' then 'late_status_ignored'
      when pay.provider_transaction_id = ev->>'provider_transaction_id' then 'already_complete'
      else 'conflicting_transaction' end;
  elsif pay.status in ('refunded', 'chargeback') then
    outcome := 'reversed_ignored';
  elsif ev->>'status' <> 'complete' then
    -- A late failure never undoes a completion; a pending payment records the final state.
    if pay.status = 'pending' and ev->>'status' in ('cancelled', 'error', 'abandoned') then
      update private.payments set status = case ev->>'status' when 'cancelled' then 'cancelled' else 'failed' end,
        status_changed_at = statement_timestamp() where id = pay.id;
      outcome := 'not_paid';
    else
      outcome := 'no_change';
    end if;
  elsif nullif(ev->>'provider_transaction_id', '') is null then
    outcome := 'missing_transaction';
  elsif exists (select 1 from private.payments p where p.provider_transaction_id = ev->>'provider_transaction_id') then
    outcome := 'transaction_reused';
  else
    -- Failed/expired checkouts may still fulfill on verified late payment.
    -- Explicit cancellation never reactivates benefits: retain receipt and
    -- route it to reconciliation, independently of current target eligibility.
    snap := pay.snapshot;
    -- An invoice attempt whose invoice another payment already paid (or that
    -- was voided) is kept but not delivered: staff refund it.
    fulfillable := pay.status<>'cancelled'
      and exists(select 1 from private.current_account_access u where u.id=pay.owner_id)
      and not internal.customer_invoice_settled_elsewhere(pay.id);
    if pay.product_kind='addon' then
      select * into target from private.posts p where p.id=pay.target_post_id for update;
      fulfillable := fulfillable and found and target.owner_id=pay.owner_id
        and target.owner_id::text=snap->>'target_owner_id'
        and target.kind=snap->>'target_kind' and target.area=snap->>'target_area'
        and (snap->>'addon'='urgent' or target.kind='event')
        and target.published_at<=clock_timestamp() and target.visible_until>clock_timestamp()
        and exists(select 1 from private.public_eligible_posts p where p.id=target.id)
        and exists(select 1 from internal.post_funding(target.id) f where f.funded_until>clock_timestamp());
      if fulfillable then
        fulfillable:=coalesce((snap->'addon_capabilities') ? (snap->>'addon'),false)
          and internal.addon_purchase_entitlement(pay.owner_id,target.id,snap->>'addon') is not null;
      end if;
    else
      select count(*) into line_count from private.payment_lines l where l.payment_id = pay.id and l.status = 'open';
      if line_count > 0 and fulfillable then
        -- Slots are delivered only within the person's limit (every account
        -- of the identity, each slot once); otherwise the money goes to
        -- reconciliation. A renewal of a held slot adds no slot (so it is
        -- delivered even to a person now over their limit), but the slots
        -- renewed ahead stay within the limit.
        fingerprint := internal.individual_slot_identity(pay.owner_id);
        if fingerprint is not null then
          perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
        end if;
        renewing := internal.slot_lines_renewing(pay.id);
        fulfillable := (internal.slot_lines_adding(pay.id) = 0
            or (internal.individual_slots_counted(fingerprint, pay.owner_id, pay.id)->>'held')::integer
              + internal.slot_lines_adding(pay.id) <= internal.individual_slot_limit(fingerprint))
          and (cardinality(renewing) = 0
            or internal.individual_slots_extended(fingerprint, pay.owner_id, pay.id, renewing)
              <= internal.individual_slot_limit(fingerprint));
      end if;
    end if;
    fulfillable := coalesce(fulfillable,false);
    update private.payments set status = 'complete', completed_at = statement_timestamp(),
      provider_transaction_id = ev->>'provider_transaction_id', status_changed_at = statement_timestamp(),
      fulfillment_status=case when fulfillable then 'fulfilled' else 'needs_reconciliation' end
    where id = pay.id;
    if not fulfillable then
      -- Receipt of verified funds is a financial fact. Never roll it back just
      -- because the old target/account disappeared or became ineligible.
      insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('payment_reconciliation_required',pay.id,pay.owner_id,'payment_reconciliation_required:'||pay.id);
    elsif pay.product_kind = 'plan' and line_count > 0 then
      -- One entitlement per slot, each with its own line (and so its own
      -- refund); a renewal starts when its slot's last period ends.
      perform internal.issue_slot_line_entitlements(pay.id);
    elsif pay.product_kind = 'plan' then
      -- A plan payment made before slot lines existed: one entitlement.
      insert into private.entitlements (owner_id, source, area, payment_id, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))));
    else
      -- Stacking: a new window starts when the member's current window of that kind ends.
      select greatest(statement_timestamp(), coalesce(max(w.ends_at), statement_timestamp())) into window_start
      from private.post_addon_windows w
      where w.post_id = pay.target_post_id and w.kind = snap->>'addon' and w.revoked_at is null;
      insert into private.post_addon_windows (post_id, kind, payment_id, starts_at, ends_at)
      values (pay.target_post_id, snap->>'addon', pay.id, window_start,
        window_start + make_interval(days => (snap->>'days')::integer));
    end if;
    vat := internal.payment_invoice_vat(pay);
    insert into private.invoices (payment_id, invoice_number, amount_ex_vat_cents, vat_cents, total_cents, description)
    values (pay.id, 'INV-' || to_char(statement_timestamp() at time zone 'Africa/Johannesburg', 'YYYYMMDD') || '-'
        || upper(left(replace(pay.id::text, '-', ''), 10)),
      pay.amount_cents - vat, vat, pay.amount_cents,
      coalesce(snap->>'invoice_description', snap->>'label', initcap(snap->>'addon') || ' ' || (snap->>'days') || ' days'));
    insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
    values ('payment_completed', pay.id, pay.owner_id, 'payment_completed:' || pay.id);
    outcome := case when fulfillable then 'completed' else 'complete_unfulfillable_target' end;
  end if;
  insert into private.provider_events (provider, payload_sha256, merchant_reference, provider_request_id,
    provider_transaction_id, reported_status, amount_cents, currency, payment_id, outcome)
  values ('ozow', ev->>'payload_sha256', ev->>'merchant_reference', ev->>'provider_request_id',
    nullif(ev->>'provider_transaction_id', ''), ev->>'status', (ev->>'amount_cents')::bigint,
    coalesce(ev->>'currency', ''), pay.id, outcome);
  return jsonb_build_object('outcome', outcome, 'payment_id', pay.id,
    'fulfillment_status',(select p.fulfillment_status from private.payments p where p.id=pay.id));
end;
$function$;
alter function internal.apply_provider_event(jsonb) owner to postgres;
revoke all on function internal.apply_provider_event(jsonb) from public;
grant execute on function internal.apply_provider_event(jsonb) to service_role;

CREATE OR REPLACE FUNCTION internal.activate_staff_paid_payment(p_payment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; pay private.payments; snap jsonb; prior private.payment_activations;
  target private.posts; line_count integer := 0; made integer := 0; window_start timestamptz;
  fingerprint text; commissions integer := 0; has_lines boolean; renewing uuid[];
begin
  actor := internal.staff_actor('payments:refund');
  if p_payment_id is null or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false) then
    raise exception 'payment and audit reason required' using errcode='22023';
  end if;
  select p.owner_id into buyer from private.payments p where p.id = p_payment_id;
  if buyer is null then raise exception 'payment not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.lock_evidence_subject(buyer);
  select * into pay from private.payments p where p.id = p_payment_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  select * into prior from private.payment_activations a where a.payment_id = pay.id;
  if found then
    if prior.actor_id = actor and prior.reason = btrim(p_reason) then
      return jsonb_build_object('payment_id', pay.id, 'fulfillment_status', pay.fulfillment_status,
        'entitlements', prior.entitlements, 'addon_window', prior.addon_window, 'commissions', prior.commissions,
        'repeated', true);
    end if;
    raise exception 'this payment was already activated' using errcode='PT409', detail='payment_already_activated';
  end if;
  if pay.status <> 'complete' or pay.fulfillment_status <> 'needs_reconciliation' then
    raise exception 'only a paid payment that was not delivered can be activated' using errcode='PT409', detail='payment_not_awaiting_activation';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if not exists(select 1 from private.current_account_access u where u.id = pay.owner_id) then
    raise exception 'the account that paid cannot use it now; refund instead' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  if internal.customer_invoice_settled_elsewhere(pay.id) then
    raise exception 'another payment already paid this invoice (or it was voided); refund this one instead'
      using errcode='PT409', detail='invoice_paid_elsewhere';
  end if;
  snap := pay.snapshot;
  if pay.product_kind = 'addon' then
    select * into target from private.posts p where p.id = pay.target_post_id for update;
    if not (found and target.owner_id = pay.owner_id
        and target.owner_id::text = snap->>'target_owner_id'
        and target.kind = snap->>'target_kind' and target.area = snap->>'target_area'
        and (snap->>'addon' = 'urgent' or target.kind = 'event')
        and target.published_at <= clock_timestamp() and target.visible_until > clock_timestamp()
        and exists(select 1 from private.public_eligible_posts p where p.id = target.id)
        and exists(select 1 from internal.post_funding(target.id) f where f.funded_until > clock_timestamp())
        and coalesce((snap->'addon_capabilities') ? (snap->>'addon'), false)
        and internal.addon_purchase_entitlement(pay.owner_id, target.id, snap->>'addon') is not null) then
      raise exception 'the post can no longer carry this add-on; refund instead' using errcode='PT409', detail='addon_target_ineligible';
    end if;
    select greatest(statement_timestamp(), coalesce(max(w.ends_at), statement_timestamp())) into window_start
    from private.post_addon_windows w
    where w.post_id = pay.target_post_id and w.kind = snap->>'addon' and w.revoked_at is null;
    insert into private.post_addon_windows (post_id, kind, payment_id, starts_at, ends_at)
    values (pay.target_post_id, snap->>'addon', pay.id, window_start,
      window_start + make_interval(days => (snap->>'days')::integer));
  else
    has_lines := exists(select 1 from private.payment_lines l where l.payment_id = pay.id);
    if exists(select 1 from private.entitlements e where e.payment_id = pay.id) then
      raise exception 'this payment already has a slot; check it before activating' using errcode='PT409', detail='payment_slot_exists';
    end if;
    if has_lines then
      select count(*) into line_count from private.payment_lines l where l.payment_id = pay.id and l.status = 'open';
      if line_count = 0 then
        raise exception 'every slot of this payment was refunded' using errcode='PT409', detail='payment_slots_refunded';
      end if;
      -- Within the person's Individual slot limit (every account of the
      -- identity, each slot once; a renewal of a held slot adds none, and
      -- the slots renewed ahead stay within the limit).
      fingerprint := internal.individual_slot_identity(pay.owner_id);
      if fingerprint is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
      end if;
      renewing := internal.slot_lines_renewing(pay.id);
      if (internal.slot_lines_adding(pay.id) > 0
          and (internal.individual_slots_counted(fingerprint, pay.owner_id, pay.id)->>'held')::integer
            + internal.slot_lines_adding(pay.id) > internal.individual_slot_limit(fingerprint))
        or (cardinality(renewing) > 0 and internal.individual_slots_extended(fingerprint, pay.owner_id, pay.id, renewing)
          > internal.individual_slot_limit(fingerprint)) then
        raise exception 'more slots than the person''s limit; raise the limit or refund' using errcode='PT429', detail='slot_limit_reached';
      end if;
      made := internal.issue_slot_line_entitlements(pay.id);
    else
      insert into private.entitlements (owner_id, source, area, payment_id, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))));
      get diagnostics made = row_count;
    end if;
  end if;
  -- The status stays complete, so the commission trigger does not fire: the
  -- delivered purchase earns its commission here.
  update private.payments set fulfillment_status = 'fulfilled' where id = pay.id;
  commissions := internal.payment_delivery_commission(pay.id);
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_activations (payment_id, actor_id, reason, entitlements, addon_window, commissions)
    values (pay.id, actor, btrim(p_reason), made, pay.product_kind = 'addon', commissions);
  return jsonb_build_object('payment_id', pay.id, 'fulfillment_status', 'fulfilled', 'entitlements', made,
    'addon_window', pay.product_kind = 'addon', 'commissions', commissions, 'repeated', false);
end;
$function$;
alter function internal.activate_staff_paid_payment(uuid,text) owner to postgres;
revoke all on function internal.activate_staff_paid_payment(uuid,text) from public;
grant execute on function internal.activate_staff_paid_payment(uuid,text) to authenticated;

-- 4 and 5. The service sweep: posts move into the next period of their slot,
-- and reminders are queued 3 days before a slot ends unrenewed.
CREATE OR REPLACE FUNCTION internal.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n_moved integer := 0; n_reminders integer := 0; r record; post private.posts; next_grant private.entitlements;
  activation private.post_activations; used integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023';
  end if;
  -- 1. Hand-over. A post whose period has ended moves to the slot's period
  -- that follows on from it without a break and covers now. Candidates are
  -- unlocked: take the owner's fence, then lock and recheck.
  for r in
    select a.id as activation_id, a.post_id, a.owner_id, n.id as next_id
    from private.post_activations a
      join private.entitlements g on g.id=a.entitlement_id
      join private.entitlements n on n.slot_id=coalesce(g.slot_id, g.id)
    where a.released_at is null and a.post_id is not null and g.status='active' and g.ends_at<=clock_timestamp()
      and n.status='active' and n.starts_at>g.starts_at and n.starts_at<=clock_timestamp() and n.ends_at>clock_timestamp()
      and n.ends_at<=internal.slot_chain_end(g.id)
    order by g.ends_at, a.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.post_id for update skip locked;
    if not found then continue; end if;
    select * into activation from private.post_activations a where a.id=r.activation_id and a.released_at is null
      and a.post_id=post.id;
    if not found then continue; end if;
    select * into next_grant from private.entitlements e where e.id=r.next_id for update;
    -- Recheck under the locks: the next period still follows on, covers now,
    -- may carry this post and has room for it.
    continue when next_grant.status<>'active' or next_grant.starts_at>clock_timestamp()
      or next_grant.ends_at<=clock_timestamp()
      or next_grant.ends_at>internal.slot_chain_end(activation.entitlement_id)
      or not internal.entitlement_for_post_eligible(next_grant.id, post.id, post.owner_id);
    select count(*) into used from private.post_activations a where a.released_at is null and a.id<>activation.id
      and a.entitlement_id in (select c.id from private.entitlements c
        where c.id=coalesce(next_grant.slot_id, next_grant.id) or c.slot_id=coalesce(next_grant.slot_id, next_grant.id));
    continue when used + 1 > next_grant.slot_capacity;
    update private.post_activations set released_at=clock_timestamp(), release_reason='entitlement_ended'
      where id=activation.id;
    insert into private.post_activations (post_id, entitlement_id, owner_id, activated_at, continued)
      values (post.id, next_grant.id, post.owner_id, clock_timestamp(), true);
    perform internal.refresh_slot_chain_posts(coalesce(next_grant.slot_id, next_grant.id));
    n_moved := n_moved + 1;
  end loop;
  -- 2. Reminders: one per grant (so one per slot end, whatever the retries),
  -- for an Individual slot ending within 3 days with no renewal following it.
  with due as (
    select g.id, g.owner_id from private.entitlements g
      join private.payment_lines l on l.id=g.payment_line_id
      join private.plan_versions v on v.id=l.plan_version_id
    where g.source='retail_paid' and g.status='active' and internal.individual_slot_plan(v.plan_code)
      and g.ends_at>clock_timestamp() and g.ends_at<=clock_timestamp()+interval '3 days'
      and internal.slot_renewal_due(g.id, g.owner_id)
      and not exists(select 1 from private.outbox_events o where o.dedupe_key='slot_renewal_reminder:'||g.id)
    order by g.ends_at, g.id limit p_limit
  )
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
    select 'slot_renewal_reminder', d.id, d.owner_id, 'slot_renewal_reminder:'||d.id from due d
    on conflict (dedupe_key) do nothing;
  get diagnostics n_reminders = row_count;
  return jsonb_build_object('moved', n_moved, 'reminders', n_reminders);
end;
$function$;
alter function internal.run_slot_renewals(integer) owner to postgres;
revoke all on function internal.run_slot_renewals(integer) from public, anon, authenticated, service_role;
grant execute on function internal.run_slot_renewals(integer) to service_role;

CREATE OR REPLACE FUNCTION api.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.run_slot_renewals(p_limit);
$function$;
alter function api.run_slot_renewals(integer) owner to postgres;
revoke all on function api.run_slot_renewals(integer) from public, anon, authenticated, service_role;
grant execute on function api.run_slot_renewals(integer) to service_role;

-- 5. The mail claim, with the reminder: sent only to a confirmed address and
-- only while the slot still ends unrenewed (otherwise finished unsent).
CREATE OR REPLACE FUNCTION internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  -- Each kind once; 21 kinds since the renewal reminder.
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 21 or coalesce(array_ndims(p_supported_kinds),0)<>1
    or (select count(distinct coalesce(k,'')) from unnest(p_supported_kinds) k)<>cardinality(p_supported_kinds) then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept','verification_returned','slot_renewal_reminder')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
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
      and (o.kind<>'slot_renewal_reminder' or internal.slot_renewal_due(o.subject_id,o.owner_id)) then u.email end,
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
        and internal.slot_renewal_due(x.id,o.owner_id)) end) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end
    left join private.entitlements tr on o.kind='trial_started' and tr.id=o.subject_id and tr.source='intro_trial'
      and tr.owner_id=o.owner_id and tr.status='active'
    left join private.entitlements sg on o.kind='slot_renewal_reminder' and sg.id=o.subject_id and sg.owner_id=o.owner_id;
  return result;
end;
$function$;
alter function internal.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

-- 6. "My slots" with renewals.
CREATE OR REPLACE FUNCTION internal.get_my_slots_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); verified text; fingerprint text; counted jsonb; raise_ends timestamptz;
  result jsonb;
begin
  verified:=internal.current_verified_identity(actor);
  fingerprint:=coalesce(verified, internal.individual_slot_identity(actor));
  counted:=internal.individual_slots_counted(fingerprint, actor, null);
  select l.ends_at into raise_ends from private.individual_slot_limits l
    where l.identity_hmac=fingerprint and l.revoked_at is null and l.ends_at>clock_timestamp();
  select jsonb_build_object(
    'slots', coalesce((select jsonb_agg(s.slot order by s.ended, s.ends_at, s.id) from (
        select e.id, e.ends_at, e.ends_at<=statement_timestamp() as ended, jsonb_build_object(
          'id', e.id, 'source', e.source,
          'individual', coalesce(internal.individual_slot_plan(v.plan_code), false),
          'label', coalesce(v.label, pay.snapshot->>'label'),
          'area', e.area, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
          'state', case when e.starts_at>statement_timestamp() then 'upcoming'
            when e.ends_at>statement_timestamp() then 'active' else 'ended' end,
          'places', e.slot_capacity,
          'sponsor', (select o.name from private.organisation_sponsorships sp
              join private.organisations o on o.id=sp.organisation_id where sp.entitlement_id=e.id limit 1),
          -- Renewing: an Individual slot that is still held can be renewed
          -- from 14 days before it ends (renew_opens_at); renewed_until is
          -- the end of its unbroken run of renewed periods.
          'renewable', coalesce(internal.individual_slot_plan(v.plan_code), false) and l.status='open'
            and pay.status='complete' and internal.slot_chain_held(e.id)
            and internal.slot_chain_last_end(e.id)<=clock_timestamp()+internal.slot_renewal_window(),
          'renew_opens_at', case when coalesce(internal.individual_slot_plan(v.plan_code), false) and l.status='open'
              and pay.status='complete' and internal.slot_chain_held(e.id)
            then internal.slot_chain_last_end(e.id)-internal.slot_renewal_window() end,
          'renewed_until', case when internal.slot_chain_end(e.id)>e.ends_at then internal.slot_chain_end(e.id) end,
          'renewals', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'starts_at', n.starts_at,
                'ends_at', n.ends_at) order by n.starts_at, n.id)
              from private.entitlements n where n.slot_id=coalesce(e.slot_id, e.id) and n.status='active'
                and n.starts_at>greatest(e.starts_at, statement_timestamp())), '[]'),
          'posts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'area', x.area,
                'title', x.title, 'status', x.status, 'deletes_at', x.deletes_at) order by x.activated_at, x.id)
              from (select distinct on (p.id) p.id, p.kind, p.area, p.title, p.status, p.deletes_at, a.activated_at
                from private.post_activations a join private.posts p on p.id=a.post_id
                where p.owner_id=actor and p.edit_of is null
                  and (a.entitlement_id=e.id
                    -- a post still in the period that just ended, waiting to move to this one
                    or (a.released_at is null and a.entitlement_id in (select c.id from private.entitlements c
                      where c.id<>e.id and (c.id=coalesce(e.slot_id, e.id) or c.slot_id=coalesce(e.slot_id, e.id))
                        and c.ends_at<=statement_timestamp() and c.ends_at>=e.starts_at
                        and e.starts_at<=statement_timestamp())))
                  and (a.released_at is null
                    or (a.entitlement_id=e.id and e.ends_at<=statement_timestamp()
                      and a.release_reason in ('expired','entitlement_ended')
                      and p.status='expired' and p.deletes_at>statement_timestamp()
                      and not exists(select 1 from private.post_activations n where n.post_id=p.id and n.released_at is null)))
                order by p.id, a.activated_at desc) x), '[]')) as slot
        from private.entitlements e
          left join private.payment_lines l on l.id=e.payment_line_id
          left join private.plan_versions v on v.id=l.plan_version_id
          left join private.payments pay on pay.id=e.payment_id
        where e.owner_id=actor and e.status='active' and e.ends_at>statement_timestamp()-interval '3 days'
          -- the current period of each slot, a period that ended in the last
          -- 3 days unless the next one followed on from it, and a renewal
          -- waiting to start when its slot has no current period
          and (e.starts_at<=statement_timestamp() or not exists(select 1 from private.entitlements c
            where (c.id=coalesce(e.slot_id, e.id) or c.slot_id=coalesce(e.slot_id, e.id)) and c.id<>e.id
              and c.status='active' and c.starts_at<=statement_timestamp() and c.ends_at>statement_timestamp()))
          and (e.starts_at<=statement_timestamp() or not exists(select 1 from private.entitlements c
            where c.slot_id=coalesce(e.slot_id, e.id) and c.id<>e.id and c.status='active'
              and c.starts_at>statement_timestamp() and c.starts_at<e.starts_at))
          and not (e.ends_at<=statement_timestamp() and exists(select 1 from private.entitlements n
            where n.slot_id=coalesce(e.slot_id, e.id) and n.id<>e.id and n.status='active'
              and n.starts_at<=e.ends_at and n.ends_at>e.ends_at))
        order by e.ends_at desc limit 200) s), '[]'),
    'individual', jsonb_build_object('verified', verified is not null,
      'held', (counted->>'held')::integer, 'pending', (counted->>'pending')::integer,
      'renewed_ahead', internal.individual_slots_extended(fingerprint, actor, null, null),
      'limit', internal.individual_slot_limit(fingerprint), 'limit_ends_at', raise_ends)) into result;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_slots_v2() owner to postgres;
revoke all on function internal.get_my_slots_v2() from public, anon, authenticated, service_role;
grant execute on function internal.get_my_slots_v2() to authenticated;

CREATE OR REPLACE FUNCTION api.get_my_slots_v2()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_slots_v2();
$function$;
alter function api.get_my_slots_v2() owner to postgres;
revoke all on function api.get_my_slots_v2() from public, anon, authenticated, service_role;
grant execute on function api.get_my_slots_v2() to authenticated;

-- 7. Retention keeps a grant while a later renewal or a payment line names it.
CREATE OR REPLACE FUNCTION internal.retention_commerce(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare provider_events integer; invoices integer; addon_windows integer; partner_events integer;
  commissions integer; acquisitions integer; sponsorships integer; trial_claims integer; activations integer;
  entitlements integer; payments integer; customer_invoices integer; bank_transfers integer;
begin
  delete from private.provider_events where id in(select e.id from private.provider_events e
    where internal.retention_tax_year_due(e.received_at) order by e.received_at limit p_limit);
  get diagnostics provider_events=row_count;
  delete from private.invoices where id in(select i.id from private.invoices i
    where internal.retention_tax_year_due(i.issued_at) order by i.issued_at limit p_limit);
  get diagnostics invoices=row_count;
  -- Recorded bank transfers: five tax years after they were confirmed,
  -- declined or recorded, and always with the invoice they name.
  delete from private.invoice_transfers where id in(select t.id from private.invoice_transfers t
    where internal.retention_tax_year_due(coalesce(t.confirmed_at,t.declined_at,t.recorded_at))
      or t.customer_invoice_id in(select i.id from private.customer_invoices i
        where internal.retention_tax_year_due(coalesce(i.paid_at,i.voided_at,i.issued_at)))
    order by t.recorded_at limit p_limit);
  get diagnostics bank_transfers=row_count;
  delete from private.customer_invoice_payments where invoice_id in(select i.id from private.customer_invoices i
    where internal.retention_tax_year_due(coalesce(i.paid_at,i.voided_at,i.issued_at))
      and not exists(select 1 from private.invoice_transfers t where t.customer_invoice_id=i.id)
    order by i.issued_at limit p_limit);
  delete from private.customer_invoices where id in(select i.id from private.customer_invoices i
    where internal.retention_tax_year_due(coalesce(i.paid_at,i.voided_at,i.issued_at))
      and not exists(select 1 from private.customer_invoice_payments l where l.invoice_id=i.id)
      and not exists(select 1 from private.invoice_transfers t where t.customer_invoice_id=i.id)
    order by i.issued_at limit p_limit);
  get diagnostics customer_invoices=row_count;
  delete from private.post_addon_windows where id in(select w.id from private.post_addon_windows w
    where coalesce(w.revoked_at,w.ends_at)<=statement_timestamp()
      and internal.retention_tax_year_due(coalesce(w.revoked_at,w.ends_at)) order by w.ends_at limit p_limit);
  get diagnostics addon_windows=row_count;
  delete from private.partner_events where id in(select e.id from private.partner_events e
    where internal.retention_tax_year_due(e.created_at) order by e.created_at limit p_limit);
  get diagnostics partner_events=row_count;
  delete from private.partner_commissions where id in(select c.id from private.partner_commissions c
    where c.status in('paid','reversed') and internal.retention_tax_year_due(coalesce(c.reversed_at,c.paid_at))
      and not exists(select 1 from private.partner_events e where e.commission_id=c.id)
    order by c.created_at limit p_limit for update skip locked);
  get diagnostics commissions=row_count;
  delete from private.account_acquisitions where account_id in(select a.account_id from private.account_acquisitions a
    where internal.retention_tax_year_due(a.recorded_at) order by a.recorded_at limit p_limit);
  get diagnostics acquisitions=row_count;
  delete from private.organisation_sponsorships where id in(select s.id from private.organisation_sponsorships s
    where s.status in('ended','revoked') and internal.retention_tax_year_due(s.ended_at)
    order by s.ended_at limit p_limit for update skip locked);
  get diagnostics sponsorships=row_count;
  delete from private.post_trial_claims where post_id in(select c.post_id from private.post_trial_claims c
    where internal.retention_tax_year_due(coalesce(c.converted_at,c.claimed_at)) order by c.claimed_at limit p_limit);
  get diagnostics trial_claims=row_count;
  delete from private.post_activations where id in(select a.id from private.post_activations a
    where a.released_at is not null and internal.retention_tax_year_due(a.released_at)
      and not exists(select 1 from private.post_trial_claims c where c.converted_by_activation_id=a.id)
    order by a.released_at limit p_limit for update skip locked);
  get diagnostics activations=row_count;
  -- A slot's periods go newest first: a grant stays while a later renewal (or
  -- a payment line) still names it.
  delete from private.entitlements where id in(select e.id from private.entitlements e
    where (e.status='revoked' or e.ends_at<=statement_timestamp())
      and internal.retention_tax_year_due(coalesce(e.ends_at,e.created_at))
      and not exists(select 1 from private.organisation_sponsorships s where s.entitlement_id=e.id)
      and not exists(select 1 from private.post_activations a where a.entitlement_id=e.id)
      and not exists(select 1 from private.post_trial_claims c where c.trial_entitlement_id=e.id)
      and not exists(select 1 from private.trial_identities t where t.entitlement_id=e.id)
      and not exists(select 1 from private.entitlements r where r.renews_entitlement_id=e.id or r.slot_id=e.id)
      and not exists(select 1 from private.payment_lines l where l.renews_entitlement_id=e.id)
    order by e.created_at limit p_limit for update skip locked);
  get diagnostics entitlements=row_count;
  delete from private.payments where id in(select p.id from private.payments p
    where p.status<>'pending' and internal.retention_tax_year_due(coalesce(p.completed_at,p.status_changed_at,p.created_at))
      and not exists(select 1 from private.entitlements e where e.payment_id=p.id)
      and not exists(select 1 from private.invoices i where i.payment_id=p.id)
      and not exists(select 1 from private.partner_commissions c where c.payment_id=p.id)
      and not exists(select 1 from private.post_addon_windows w where w.payment_id=p.id)
      and not exists(select 1 from private.provider_events e where e.payment_id=p.id)
      and not exists(select 1 from private.customer_invoice_payments l where l.payment_id=p.id)
      and not exists(select 1 from private.customer_invoices ci where ci.payment_id=p.id)
      and not exists(select 1 from private.invoice_transfers t where t.payment_id=p.id)
    order by p.created_at limit p_limit for update skip locked);
  get diagnostics payments=row_count;
  return jsonb_build_object('provider_events',provider_events,'invoices',invoices,'addon_windows',addon_windows,
    'partner_events',partner_events,'partner_commissions',commissions,'account_acquisitions',acquisitions,
    'sponsorships',sponsorships,'post_trial_claims',trial_claims,'post_activations',activations,
    'entitlements',entitlements,'payments',payments,'customer_invoices',customer_invoices,
    'bank_transfers',bank_transfers);
end;
$function$;
alter function internal.retention_commerce(integer) owner to postgres;
revoke all on function internal.retention_commerce(integer) from public;

commit;
