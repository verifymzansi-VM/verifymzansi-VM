-- Staff find and fix paid but not delivered (roadmap M3.4), and refunds with
-- Ozow's reference, a reason code and a second approver; plus the read the
-- payment receipt email needs (M3.7).
--
-- Apply after 20261113002421_individual_slots_r69.sql (it refuses with 55000
-- unless that update's payment lines and staff rule are present). Only adds:
-- no existing command, argument, grant or function body changes, so the
-- website release deployed before it keeps working. In one transaction it:
--
-- 1. New staff read api.get_staff_payment_list(p_page, p_filter): the staff
--    payments list with each payment's delivery status (fulfillment_status),
--    its slots (payment lines), a refund waiting for approval and when it was
--    activated by staff; the filter takes the payment statuses, plus
--    'needs_attention' (paid but not delivered: complete and
--    needs_reconciliation) and 'awaiting_approval' (a refund waiting for a
--    second staff member). It also counts the payments that need attention.
--    api.get_frontend_staff_payments stays for the release before this one.
-- 2. New staff command api.activate_staff_paid_payment(p_payment_id,
--    p_reason) ("activate what was paid for", capability payments:refund):
--    delivers what a complete, needs_reconciliation payment paid for (a plan:
--    one entitlement per open slot line within the person's Individual slot
--    limit, or one entitlement for a plan payment without lines; an add-on:
--    its window, while the post can still carry it), marks the payment
--    fulfilled, records an audit row (private.payment_activations) and
--    creates the partner commission the purchase earns: the commission
--    trigger fires only when a payment's status changes, and activation
--    leaves the status complete.
-- 3. New staff commands api.record_staff_payment_refund(p_payment_id, p_kind,
--    p_reason_code, p_reason, p_ozow_reference) and
--    api.record_staff_slot_refund(p_line_id, p_kind, p_reason_code, p_reason,
--    p_ozow_reference): a refund or chargeback of a whole payment or of one
--    slot, recorded only with Ozow's reference (stored, used once whatever its
--    letter case) and a reason code (billing_error, duplicate,
--    our_failure_after_fix_offered, s14_cancellation, breach_credit). When the
--    money returned on the payment, this record included, would exceed R1,000
--    (100,000 cents), the record waits for a second, different staff member
--    (api.approve_staff_payment_refund) and takes effect only then, so a large
--    refund cannot be split slot by slot; chargebacks follow the same rule
--    while internal.chargebacks_need_approval() is true. Any staff member with
--    the capability can decline a waiting record with a reason
--    (api.decline_staff_payment_refund). The amount is always the payment's or
--    the slot's own amount, and the record names the account that paid
--    (private.payment_refund_requests.account_id, checked against the
--    payment). The earlier commands api.record_frontend_staff_payment_reversal
--    and api.record_staff_slot_reversal stay until a later contract step.
-- 4. Staff never act for themselves: every new staff command needs the staff
--    member's own current accepted ID review and refuses a payment of their
--    own identity (internal.assert_staff_payment_actor, using
--    internal.same_identity over every fingerprint either account has had),
--    before the lock waits and again after the last authority check; the
--    approver must also be another person than the requester, checked again
--    after the lock waits.
-- 5. The staff audit trail (private.frontend_staff_audit_events) also lists
--    activations, refund requests, approvals, declines and single-slot
--    reversals.
-- 6. New service read api.get_payment_receipt(p_payment_id): the details of
--    one payment and its invoice for the receipt email (M3.7); null for an
--    unknown payment. Only service_role may call it.
-- 7. While a refund or chargeback waits for approval, nothing else reverses
--    that payment or one of its slots (new triggers payments_refund_waiting and
--    payment_lines_refund_waiting on the existing tables; only the approval
--    passes), and staff cannot activate it.
--
-- ORDER: apply this update before the pull request that uses it is merged (a
-- merge into main is deployed, and that release calls the new commands).
-- Read-only preflight: ../preflight/20261113021223_staff_payment_fixes.check.sql.
-- Rollback: ../rollback/20261113021223_staff_payment_fixes.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: the individual slots update is applied with its reviewed
-- bodies; the new tables are absent or exactly this update's.
do $$
declare shape text;
begin
  if to_regclass('private.payment_lines') is null
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.assert_staff_acts_for_other(uuid,uuid,text)')) is distinct from 'ed7d0d3df9bdade439b2df65126d5506'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.same_identity(uuid,uuid)')) is distinct from '535e5c87d944edd45bd2b3dce28f98b6'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.reverse_payment(uuid,text,text)')) is distinct from '66005adb9e06b17e689dbac47ce93d5a'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_slot_reversal(uuid,text,text)')) is distinct from '1364f8c78e36281bae5f16a4ba5a466c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_partner_commission()')) is distinct from 'e99f071fae090328566a61186843c6e2'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.apply_provider_event(jsonb)')) is distinct from '8a226003da741381225c11dfd1e44308' then
    raise exception 'staff payment fixes precondition: apply 20261113002421_individual_slots_r69.sql first (reviewed bodies required)'
      using errcode='55000';
  end if;
  for shape in
    select v.name||' '||coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
        ||case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid=to_regclass(v.name) and a.attnum>0 and not a.attisdropped),'absent')
    from (values ('private.payment_activations'),('private.payment_refund_requests')) v(name)
  loop
    if shape not in ('private.payment_activations absent','private.payment_refund_requests absent',
        'private.payment_activations payment_id:uuid!,actor_id:uuid!,reason:text!,entitlements:integer!,'
          ||'addon_window:boolean!,commissions:integer!,created_at:timestamp with time zone!',
        'private.payment_refund_requests id:uuid!,payment_id:uuid!,payment_line_id:uuid,account_id:uuid!,kind:text!,'
          ||'reason_code:text!,reason:text!,ozow_reference:text!,amount_cents:bigint!,recorded_before_cents:bigint!,'
          ||'needs_approval:boolean!,'
          ||'status:text!,requested_by:uuid!,requested_at:timestamp with time zone!,approved_by:uuid,'
          ||'applied_at:timestamp with time zone,released_activations:integer,declined_by:uuid,'
          ||'declined_at:timestamp with time zone,decline_reason:text') then
      raise exception 'staff payment fixes table drift: %', shape using errcode='55000';
    end if;
  end loop;
  -- The same tables must also carry exactly this update's constraints and indexes.
  for shape in
    select v.name||' '||case when to_regclass(v.name) is null then 'absent' else coalesce((select string_agg(s.n, ',' order by s.n collate "C") from (
        select c.conname::text as n from pg_catalog.pg_constraint c where c.conrelid=to_regclass(v.name) and c.contype <> 'n'
        union select i.relname::text from pg_catalog.pg_index x join pg_catalog.pg_class i on i.oid=x.indexrelid
          where x.indrelid=to_regclass(v.name)) s),'none') end
    from (values ('private.payment_activations'),('private.payment_refund_requests')) v(name)
  loop
    if shape not in ('private.payment_activations absent','private.payment_refund_requests absent',
        'private.payment_activations payment_activations_actor_id_fkey,payment_activations_actor_idx,payment_activations_commissions_check,'
          ||'payment_activations_entitlements_check,payment_activations_payment_id_fkey,payment_activations_pkey,'
          ||'payment_activations_reason_check',
        'private.payment_refund_requests payment_refund_requests_account_id_fkey,payment_refund_requests_account_idx,'
          ||'payment_refund_requests_amount_cents_check,payment_refund_requests_applied,payment_refund_requests_approval_rule,'
          ||'payment_refund_requests_approved_by_fkey,payment_refund_requests_approved_by_idx,payment_refund_requests_approver,'
          ||'payment_refund_requests_decline_reason_check,payment_refund_requests_declined,'
          ||'payment_refund_requests_declined_by_fkey,payment_refund_requests_declined_by_idx,payment_refund_requests_kind_check,'
          ||'payment_refund_requests_line_fkey,payment_refund_requests_line_idx,payment_refund_requests_ozow_reference_check,'
          ||'payment_refund_requests_payment_id_fkey,payment_refund_requests_payment_idx,payment_refund_requests_pkey,'
          ||'payment_refund_requests_reason_check,payment_refund_requests_reason_code_check,'
          ||'payment_refund_requests_recorded_before_cents_check,payment_refund_requests_reference_idx,'
          ||'payment_refund_requests_released_activations_check,payment_refund_requests_requested_by_fkey,'
          ||'payment_refund_requests_requested_by_idx,payment_refund_requests_status_check,payment_refund_requests_waiting_idx') then
      raise exception 'staff payment fixes constraint or index drift: %', shape using errcode='55000';
    end if;
  end loop;
end$$;

-- 1. Audit of staff activations: one per payment, never changed.
create table if not exists private.payment_activations (
  payment_id uuid primary key references private.payments (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete restrict,
  reason text not null check (internal.plain_text_valid(reason, 5, 500, true)),
  entitlements integer not null check (entitlements >= 0),
  addon_window boolean not null,
  commissions integer not null check (commissions >= 0),
  created_at timestamptz not null default statement_timestamp()
);
alter table private.payment_activations enable row level security;
revoke all on table private.payment_activations from public, anon, authenticated, service_role;
create index if not exists payment_activations_actor_idx on private.payment_activations (actor_id);

-- 2. Refunds and chargebacks recorded with Ozow's reference, and their approval.
create table if not exists private.payment_refund_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  payment_id uuid not null references private.payments (id) on delete cascade,
  payment_line_id uuid,
  account_id uuid not null references auth.users (id) on delete restrict,
  kind text not null check (kind in ('refunded', 'chargeback')),
  reason_code text not null check (reason_code in ('billing_error', 'duplicate', 'our_failure_after_fix_offered',
    's14_cancellation', 'breach_credit')),
  reason text not null check (internal.plain_text_valid(reason, 5, 500, true)),
  ozow_reference text not null check (ozow_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$'),
  amount_cents bigint not null check (amount_cents > 0),
  recorded_before_cents bigint not null check (recorded_before_cents >= 0),
  needs_approval boolean not null,
  status text not null check (status in ('awaiting_approval', 'applied', 'declined')),
  requested_by uuid not null references auth.users (id) on delete restrict,
  requested_at timestamptz not null default statement_timestamp(),
  approved_by uuid references auth.users (id) on delete restrict,
  applied_at timestamptz,
  released_activations integer check (released_activations >= 0),
  declined_by uuid references auth.users (id) on delete restrict,
  declined_at timestamptz,
  decline_reason text check (decline_reason is null or internal.plain_text_valid(decline_reason, 5, 500, true)),
  constraint payment_refund_requests_line_fkey foreign key (payment_line_id, payment_id)
    references private.payment_lines (id, payment_id) on delete cascade,
  constraint payment_refund_requests_approval_rule check (not needs_approval
    or recorded_before_cents + amount_cents > 100000),
  constraint payment_refund_requests_applied check ((status = 'applied') = (applied_at is not null and released_activations is not null)),
  constraint payment_refund_requests_declined check ((status = 'declined')
    = (declined_at is not null and declined_by is not null and decline_reason is not null)),
  constraint payment_refund_requests_approver check (case when status = 'applied' and needs_approval
    then approved_by is not null and approved_by <> requested_by else approved_by is null end)
);
alter table private.payment_refund_requests enable row level security;
revoke all on table private.payment_refund_requests from public, anon, authenticated, service_role;
-- Ozow's reference is used once, whatever its letter case.
create unique index if not exists payment_refund_requests_reference_idx on private.payment_refund_requests
  (lower(ozow_reference));
create unique index if not exists payment_refund_requests_waiting_idx on private.payment_refund_requests (payment_id)
  where status = 'awaiting_approval';
create index if not exists payment_refund_requests_payment_idx on private.payment_refund_requests (payment_id);
create index if not exists payment_refund_requests_line_idx on private.payment_refund_requests (payment_line_id, payment_id)
  where payment_line_id is not null;
create index if not exists payment_refund_requests_account_idx on private.payment_refund_requests (account_id);
create index if not exists payment_refund_requests_requested_by_idx on private.payment_refund_requests (requested_by);
create index if not exists payment_refund_requests_approved_by_idx on private.payment_refund_requests (approved_by)
  where approved_by is not null;
create index if not exists payment_refund_requests_declined_by_idx on private.payment_refund_requests (declined_by)
  where declined_by is not null;

CREATE OR REPLACE FUNCTION internal.payment_activation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- An activation is an audit record: it never changes.
  raise exception 'payment activations are immutable' using errcode='23514';
end;
$function$;
alter function internal.payment_activation_guard() owner to postgres;
revoke all on function internal.payment_activation_guard() from public, anon, authenticated, service_role;
drop trigger if exists payment_activations_immutable on private.payment_activations;
create trigger payment_activations_immutable before update on private.payment_activations
  for each row execute function internal.payment_activation_guard();

CREATE OR REPLACE FUNCTION internal.payment_refund_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- The request, its reference, amount and account never change; a request
  -- waiting for approval is applied or declined once, and the account is
  -- always the one that paid.
  if tg_op = 'INSERT' then
    if new.account_id is distinct from (select p.owner_id from private.payments p where p.id = new.payment_id)
      or new.amount_cents is distinct from coalesce(
        (select l.amount_cents from private.payment_lines l where l.id = new.payment_line_id),
        case when new.payment_line_id is null then (select p.amount_cents from private.payments p where p.id = new.payment_id) end) then
      raise exception 'a refund is the paid amount, for the account that paid' using errcode='23514';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['status','approved_by','applied_at','released_activations','declined_by','declined_at','decline_reason'])
      is distinct from (to_jsonb(old) - array['status','approved_by','applied_at','released_activations','declined_by','declined_at','decline_reason'])
    or old.status <> 'awaiting_approval' or new.status not in ('applied', 'declined') then
    raise exception 'refund records are immutable; a waiting refund is applied or declined once' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_refund_request_guard() owner to postgres;
revoke all on function internal.payment_refund_request_guard() from public, anon, authenticated, service_role;
drop trigger if exists payment_refund_requests_guard on private.payment_refund_requests;
create trigger payment_refund_requests_guard before insert or update on private.payment_refund_requests
  for each row execute function internal.payment_refund_request_guard();

-- The commission a delivered purchase earns, exactly as the commission
-- trigger (internal.payment_partner_commission) creates it when a payment is
-- confirmed and delivered at once: one per open slot line (one per payment
-- without lines). For a command that delivers a complete payment without
-- changing its status, so the trigger does not fire. Returns the number of
-- commissions created.
CREATE OR REPLACE FUNCTION internal.payment_delivery_commission(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; acq private.account_acquisitions; partner private.partners; rate integer; made integer := 0;
begin
  select * into pay from private.payments p where p.id = p_payment_id;
  if not found or pay.status <> 'complete' or pay.fulfillment_status <> 'fulfilled' then return 0; end if;
  select * into acq from private.account_acquisitions a where a.account_id = pay.owner_id;
  if acq.partner_id is null then return 0; end if;
  select * into partner from private.partners p where p.id = acq.partner_id;
  if partner.status <> 'active' or partner.account_id = pay.owner_id then return 0; end if;
  rate := coalesce(partner.commission_bps, 2000);
  if exists(select 1 from private.payment_lines l where l.payment_id = pay.id) then
    insert into private.partner_commissions(partner_id, payment_id, payment_line_id, referred_account_id, base_cents, rate_bps,
        amount_cents, eligible_at)
      select partner.id, pay.id, l.id, pay.owner_id, l.amount_cents, rate, floor(l.amount_cents::numeric*rate/10000),
        statement_timestamp()+interval '30 days'
      from private.payment_lines l where l.payment_id = pay.id and l.status = 'open' order by l.line_number
      on conflict (payment_line_id) where payment_line_id is not null do nothing;
  else
    insert into private.partner_commissions(partner_id, payment_id, referred_account_id, base_cents, rate_bps, amount_cents,
        eligible_at)
      values(partner.id, pay.id, pay.owner_id, pay.amount_cents, rate, floor(pay.amount_cents::numeric*rate/10000),
        statement_timestamp()+interval '30 days')
      on conflict (payment_id) where payment_line_id is null do nothing;
  end if;
  get diagnostics made = row_count;
  return made;
end;
$function$;
alter function internal.payment_delivery_commission(uuid) owner to postgres;
revoke all on function internal.payment_delivery_commission(uuid) from public, anon, authenticated, service_role;

-- 3. The staff payments list.
CREATE OR REPLACE FUNCTION internal.get_staff_payment_list(p_page integer, p_filter text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb; attention bigint; waiting bigint;
begin
  actor := internal.staff_actor('payments:view');
  if p_page is null or p_page not between 1 and 100000 or (p_filter is not null and p_filter not in (
      'pending','processing','complete','failed','cancelled','expired','refunded','chargeback',
      'needs_attention','awaiting_approval')) then
    raise exception 'valid payment filter required' using errcode='22023';
  end if;
  select count(*) into attention from private.payments p
    where p.status = 'complete' and p.fulfillment_status = 'needs_reconciliation';
  select count(*) into waiting from private.payment_refund_requests r where r.status = 'awaiting_approval';
  with listed as (
    select x.* from private.payments x
    where case p_filter
      when 'needs_attention' then x.status = 'complete' and x.fulfillment_status = 'needs_reconciliation'
      when 'awaiting_approval' then exists(select 1 from private.payment_refund_requests r
        where r.payment_id = x.id and r.status = 'awaiting_approval')
      else p_filter is null or x.status = p_filter end
  )
  select jsonb_build_object('total', (select count(*) from listed), 'page', p_page,
    'needs_attention', attention, 'awaiting_approval', waiting,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'user_id', p.owner_id, 'status', p.status, 'fulfillment_status', p.fulfillment_status,
      'product_kind', p.product_kind, 'amount_cents', p.amount_cents, 'created_at', p.created_at,
      'completed_at', p.completed_at, 'merchant_reference', p.merchant_reference,
      'area', coalesce(p.snapshot->>'area', p.snapshot->>'target_area', 'all'),
      'description', coalesce(p.snapshot->>'label', initcap(p.snapshot->>'addon')||' add-on', 'Payment'),
      'reversed', exists(select 1 from private.frontend_payment_reversals v where v.payment_id = p.id)
        or p.status in ('refunded', 'chargeback'),
      'activated_at', (select a.created_at from private.payment_activations a where a.payment_id = p.id),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'line_number', l.line_number,
          'amount_cents', l.amount_cents, 'status', l.status, 'reversal_kind', l.reversal_kind) order by l.line_number)
        from private.payment_lines l where l.payment_id = p.id), '[]'::jsonb),
      'refund_request', (select jsonb_build_object('id', r.id, 'line_id', r.payment_line_id, 'kind', r.kind,
          'reason_code', r.reason_code, 'amount_cents', r.amount_cents, 'ozow_reference', r.ozow_reference,
          'requested_at', r.requested_at, 'requested_by_me', internal.same_identity(r.requested_by, actor))
        from private.payment_refund_requests r where r.payment_id = p.id and r.status = 'awaiting_approval'))
      order by p.created_at desc, p.id desc), '[]'::jsonb))
    into result
  from (select * from listed order by created_at desc, id desc limit 50 offset (p_page-1)*50) p;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_payment_list(integer,text) owner to postgres;
revoke all on function internal.get_staff_payment_list(integer,text) from public, anon, authenticated, service_role;
grant execute on function internal.get_staff_payment_list(integer,text) to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_payment_list(p_page integer, p_filter text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_payment_list(p_page, p_filter);
$function$;
alter function api.get_staff_payment_list(integer,text) owner to postgres;
revoke all on function api.get_staff_payment_list(integer,text) from public, anon, authenticated, service_role;
grant execute on function api.get_staff_payment_list(integer,text) to authenticated;

-- 4. Activate what was paid for.
-- The staff rule for every new payment command: the staff member holds a
-- current accepted ID review of their own (not only an ended one), and never
-- acts on a payment of their own identity (internal.same_identity compares
-- every fingerprint either account has had, ended reviews too).
CREATE OR REPLACE FUNCTION internal.assert_staff_payment_actor(p_actor uuid, p_subject uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if internal.current_verified_identity(p_actor) is null then
    raise exception 'staff need a current accepted ID review of their own for this' using errcode='42501', detail='staff_review_required';
  end if;
  if internal.same_identity(p_actor, p_subject) then
    raise exception 'a different staff member must handle this payment' using errcode='42501', detail='staff_same_identity';
  end if;
end;
$function$;
alter function internal.assert_staff_payment_actor(uuid,uuid) owner to postgres;
revoke all on function internal.assert_staff_payment_actor(uuid,uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.activate_staff_paid_payment(p_payment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; pay private.payments; snap jsonb; prior private.payment_activations;
  target private.posts; line_count integer := 0; made integer := 0; window_start timestamptz;
  fingerprint text; commissions integer := 0; has_lines boolean;
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
      -- Within the person's Individual slot limit (every account of the identity).
      fingerprint := internal.individual_slot_identity(pay.owner_id);
      if fingerprint is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
      end if;
      if (internal.individual_slots_counted(fingerprint, pay.owner_id, pay.id)->>'held')::integer + line_count
          > internal.individual_slot_limit(fingerprint) then
        raise exception 'more slots than the person''s limit; raise the limit or refund' using errcode='PT429', detail='slot_limit_reached';
      end if;
      insert into private.entitlements (owner_id, source, area, payment_id, payment_line_id, slot_capacity,
        activations_per_period, activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      select pay.owner_id, 'retail_paid', snap->>'area', pay.id, l.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb)))
      from private.payment_lines l where l.payment_id = pay.id and l.status = 'open' order by l.line_number;
    else
      insert into private.entitlements (owner_id, source, area, payment_id, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))));
    end if;
    get diagnostics made = row_count;
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
revoke all on function internal.activate_staff_paid_payment(uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.activate_staff_paid_payment(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION api.activate_staff_paid_payment(p_payment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.activate_staff_paid_payment(p_payment_id, p_reason);
$function$;
alter function api.activate_staff_paid_payment(uuid,text) owner to postgres;
revoke all on function api.activate_staff_paid_payment(uuid,text) from public, anon, authenticated, service_role;
grant execute on function api.activate_staff_paid_payment(uuid,text) to authenticated;

-- 5. Refunds and chargebacks with Ozow's reference and a reason code.
CREATE OR REPLACE FUNCTION internal.assert_staff_refund_input(p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_ozow_reference is null or btrim(p_ozow_reference) = '' then
    raise exception 'Ozow refund reference required' using errcode='22023', detail='ozow_reference_required';
  end if;
  if p_ozow_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$' then
    raise exception 'Ozow refund reference must be 4 to 100 letters, digits or . _ : / -' using errcode='22023', detail='ozow_reference_invalid';
  end if;
  if p_kind is null or p_kind not in ('refunded', 'chargeback') then
    raise exception 'refund or chargeback required' using errcode='22023';
  end if;
  if p_reason_code is null or p_reason_code not in ('billing_error', 'duplicate', 'our_failure_after_fix_offered',
      's14_cancellation', 'breach_credit') then
    raise exception 'valid refund reason code required' using errcode='22023', detail='refund_reason_code_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
end;
$function$;
alter function internal.assert_staff_refund_input(text,text,text,text) owner to postgres;
revoke all on function internal.assert_staff_refund_input(text,text,text,text) from public, anon, authenticated, service_role;

-- A repeat of the same request by the same staff member returns its state;
-- a reference already recorded for anything else is refused.
CREATE OR REPLACE FUNCTION internal.staff_refund_repeat(p_actor uuid, p_payment_id uuid, p_line_id uuid, p_kind text,
  p_reason_code text, p_reason text, p_ozow_reference text)
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
revoke all on function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) from public, anon, authenticated, service_role;

-- The second-approver rule. THE ONE SWITCH for chargebacks: true means a
-- chargeback above the threshold waits for a second staff member like a
-- refund (the safe default until the owner decides); false lets chargebacks
-- take effect at once.
CREATE OR REPLACE FUNCTION internal.chargebacks_need_approval()
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select true;
$function$;
alter function internal.chargebacks_need_approval() owner to postgres;
revoke all on function internal.chargebacks_need_approval() from public, anon, authenticated, service_role;

-- Money already returned or waiting to be returned on a payment: every
-- applied or waiting refund or chargeback record, plus slots reversed without
-- one (the earlier single-slot command), but never the slots of a payment
-- reversed whole by a record (that record already counts them).
CREATE OR REPLACE FUNCTION internal.payment_refunded_before_cents(p_payment_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((select sum(r.amount_cents) from private.payment_refund_requests r
      where r.payment_id = p_payment_id and r.status in ('applied', 'awaiting_approval')), 0)
    + coalesce((select sum(l.amount_cents) from private.payment_lines l
      where l.payment_id = p_payment_id and l.status = 'reversed'
        and not exists(select 1 from private.payment_refund_requests r
          where r.status = 'applied' and r.payment_id = p_payment_id
            and (r.payment_line_id = l.id or r.payment_line_id is null))), 0)::bigint;
$function$;
alter function internal.payment_refunded_before_cents(uuid) owner to postgres;
revoke all on function internal.payment_refunded_before_cents(uuid) from public, anon, authenticated, service_role;

-- A second staff member must approve when the money returned on the payment,
-- this record included, would exceed R1,000 (100,000 cents), so a large
-- refund cannot be split slot by slot or relabelled as a chargeback.
CREATE OR REPLACE FUNCTION internal.refund_needs_approval(p_kind text, p_refunded_before bigint, p_amount bigint)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select (p_kind = 'refunded' or internal.chargebacks_need_approval())
    and coalesce(p_refunded_before, 0) + p_amount > 100000;
$function$;
alter function internal.refund_needs_approval(text,bigint,bigint) owner to postgres;
revoke all on function internal.refund_needs_approval(text,bigint,bigint) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.record_staff_payment_refund(p_payment_id uuid, p_kind text, p_reason_code text,
  p_reason text, p_ozow_reference text)
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
revoke all on function internal.record_staff_payment_refund(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function internal.record_staff_payment_refund(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.record_staff_payment_refund(p_payment_id uuid, p_kind text, p_reason_code text,
  p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_payment_refund(p_payment_id, p_kind, p_reason_code, p_reason, p_ozow_reference);
$function$;
alter function api.record_staff_payment_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function api.record_staff_payment_refund(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function api.record_staff_payment_refund(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.record_staff_slot_refund(p_line_id uuid, p_kind text, p_reason_code text,
  p_reason text, p_ozow_reference text)
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
revoke all on function internal.record_staff_slot_refund(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function internal.record_staff_slot_refund(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.record_staff_slot_refund(p_line_id uuid, p_kind text, p_reason_code text,
  p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_slot_refund(p_line_id, p_kind, p_reason_code, p_reason, p_ozow_reference);
$function$;
alter function api.record_staff_slot_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function api.record_staff_slot_refund(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function api.record_staff_slot_refund(uuid,text,text,text,text) to authenticated;

-- A second, different staff member approves a waiting refund: it takes effect now.
CREATE OR REPLACE FUNCTION internal.approve_staff_payment_refund(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; request private.payment_refund_requests; pay private.payments; result jsonb;
begin
  actor := internal.staff_actor('payments:refund');
  if p_request_id is null then raise exception 'refund request required' using errcode='22023'; end if;
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  if not found then raise exception 'refund request not found' using errcode='22023'; end if;
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must approve this refund' using errcode='42501', detail='refund_approver_same';
  end if;
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||request.payment_id::text, 0));
  perform internal.lock_evidence_subject(request.account_id);
  select * into pay from private.payments p where p.id = request.payment_id for update;
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must approve this refund' using errcode='42501', detail='refund_approver_same';
  end if;
  if request.status = 'applied' and request.approved_by = actor then
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', request.kind,
      'released_activations', request.released_activations, 'payment_status', pay.status, 'repeated', true);
  end if;
  if request.status <> 'awaiting_approval' then
    raise exception 'this refund is no longer waiting for approval' using errcode='PT409', detail='refund_not_waiting';
  end if;
  -- The payment or slot changed since the refund was recorded (for example a
  -- reversal recorded before this rule existed): decline it and record again.
  if pay.status <> 'complete'
    or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id)
    or (request.payment_line_id is null
      and exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed'))
    or (request.payment_line_id is not null
      and not exists(select 1 from private.payment_lines l where l.id = request.payment_line_id and l.status = 'open')) then
    raise exception 'the payment changed since this refund was recorded; decline it and record it again'
      using errcode='PT409', detail='refund_payment_changed';
  end if;
  -- Only this approval may reverse the payment while the refund waits
  -- (internal.payment_reversal_waiting_guard).
  perform set_config('vm.refund_approval', request.id::text, true);
  if request.payment_line_id is null then
    result := internal.reverse_payment(pay.id, request.kind, request.reason);
    insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
      values (pay.id, actor, request.kind, request.reason, (result->>'released_activations')::integer);
  else
    result := internal.record_staff_slot_reversal(request.payment_line_id, request.kind, request.reason);
  end if;
  perform set_config('vm.refund_approval', '', true);
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  update private.payment_refund_requests set status = 'applied', approved_by = actor, applied_at = statement_timestamp(),
    released_activations = (result->>'released_activations')::integer
    where id = request.id returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', request.kind,
    'released_activations', request.released_activations,
    'payment_status', (select p.status from private.payments p where p.id = pay.id), 'repeated', false);
end;
$function$;
alter function internal.approve_staff_payment_refund(uuid) owner to postgres;
revoke all on function internal.approve_staff_payment_refund(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.approve_staff_payment_refund(uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.approve_staff_payment_refund(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.approve_staff_payment_refund(p_request_id);
$function$;
alter function api.approve_staff_payment_refund(uuid) owner to postgres;
revoke all on function api.approve_staff_payment_refund(uuid) from public, anon, authenticated, service_role;
grant execute on function api.approve_staff_payment_refund(uuid) to authenticated;

-- A waiting refund is declined (or withdrawn by its requester) with a reason.
CREATE OR REPLACE FUNCTION internal.decline_staff_payment_refund(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; request private.payment_refund_requests;
begin
  actor := internal.staff_actor('payments:refund');
  if p_request_id is null or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false) then
    raise exception 'refund request and reason required' using errcode='22023';
  end if;
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  if not found then raise exception 'refund request not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||request.payment_id::text, 0));
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  if request.status = 'declined' and request.declined_by = actor and request.decline_reason = btrim(p_reason) then
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'repeated', true);
  end if;
  if request.status <> 'awaiting_approval' then
    raise exception 'this refund is no longer waiting for approval' using errcode='PT409', detail='refund_not_waiting';
  end if;
  update private.payment_refund_requests set status = 'declined', declined_by = actor,
    declined_at = statement_timestamp(), decline_reason = btrim(p_reason)
    where id = request.id;
  return jsonb_build_object('request_id', request.id, 'status', 'declined', 'repeated', false);
end;
$function$;
alter function internal.decline_staff_payment_refund(uuid,text) owner to postgres;
revoke all on function internal.decline_staff_payment_refund(uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.decline_staff_payment_refund(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION api.decline_staff_payment_refund(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.decline_staff_payment_refund(p_request_id, p_reason);
$function$;
alter function api.decline_staff_payment_refund(uuid,text) owner to postgres;
revoke all on function api.decline_staff_payment_refund(uuid,text) from public, anon, authenticated, service_role;
grant execute on function api.decline_staff_payment_refund(uuid,text) to authenticated;

-- While a refund or chargeback of a payment waits for a second staff member,
-- nothing else may reverse that payment or one of its slots (the earlier
-- commands api.record_frontend_staff_payment_reversal and
-- api.record_staff_slot_reversal, or the service's api.reverse_payment): only
-- its approval, which names the request in the transaction setting
-- vm.refund_approval while it applies it.
CREATE OR REPLACE FUNCTION internal.payment_reversal_waiting_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare payment uuid := (case when tg_table_name = 'payments' then to_jsonb(new)->>'id'
  else to_jsonb(new)->>'payment_id' end)::uuid;
begin
  if exists(select 1 from private.payment_refund_requests r
      where r.payment_id = payment and r.status = 'awaiting_approval'
        and r.id::text is distinct from nullif(current_setting('vm.refund_approval', true), '')) then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  return new;
end;
$function$;
alter function internal.payment_reversal_waiting_guard() owner to postgres;
revoke all on function internal.payment_reversal_waiting_guard() from public, anon, authenticated, service_role;
drop trigger if exists payments_refund_waiting on private.payments;
create trigger payments_refund_waiting before update of status on private.payments
  for each row when (new.status in ('refunded', 'chargeback') and old.status is distinct from new.status)
  execute function internal.payment_reversal_waiting_guard();
drop trigger if exists payment_lines_refund_waiting on private.payment_lines;
create trigger payment_lines_refund_waiting before update of status on private.payment_lines
  for each row when (new.status = 'reversed' and old.status = 'open')
  execute function internal.payment_reversal_waiting_guard();

-- 6. The staff audit trail also lists the new payment actions and every
-- single-slot reversal.
create or replace view private.frontend_staff_audit_events with (security_invoker=true) as
 SELECT frontend_staff_nonpayment_audit_events.id,
    frontend_staff_nonpayment_audit_events.occurred_at,
    frontend_staff_nonpayment_audit_events.actor_id,
    frontend_staff_nonpayment_audit_events.target_id,
    frontend_staff_nonpayment_audit_events.target_type,
    frontend_staff_nonpayment_audit_events.action,
    frontend_staff_nonpayment_audit_events.reason
   FROM private.frontend_staff_nonpayment_audit_events
UNION ALL
 SELECT 'payment:'::text || r.payment_id::text AS id,
    r.created_at AS occurred_at,
    r.actor_id,
    r.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || r.kind AS action,
    r.reason
   FROM private.frontend_payment_reversals r
UNION ALL
 SELECT 'payment_activation:'::text || a.payment_id::text AS id,
    a.created_at AS occurred_at,
    a.actor_id,
    a.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:activated'::text AS action,
    a.reason
   FROM private.payment_activations a
UNION ALL
 SELECT 'payment_refund_request:'::text || q.id::text AS id,
    q.requested_at AS occurred_at,
    q.requested_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || q.kind || '_recorded'::text AS action,
    q.reason_code || ' (Ozow '::text || q.ozow_reference || '): '::text || q.reason AS reason
   FROM private.payment_refund_requests q
UNION ALL
 SELECT 'payment_refund_approved:'::text || q.id::text AS id,
    q.applied_at AS occurred_at,
    q.approved_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || q.kind || '_approved'::text AS action,
    q.reason_code || ' (Ozow '::text || q.ozow_reference || '): '::text || q.reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.approved_by IS NOT NULL
UNION ALL
 SELECT 'payment_refund_declined:'::text || q.id::text AS id,
    q.declined_at AS occurred_at,
    q.declined_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || q.kind || '_declined'::text AS action,
    q.decline_reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.declined_by IS NOT NULL
UNION ALL
 SELECT 'payment_slot:'::text || l.id::text AS id,
    l.reversed_at AS occurred_at,
    l.reversed_by AS actor_id,
    l.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:slot_'::text || l.reversal_kind AS action,
    l.reversal_reason AS reason
   FROM private.payment_lines l
  WHERE l.reversed_by IS NOT NULL;
alter view private.frontend_staff_audit_events owner to postgres;
revoke all on private.frontend_staff_audit_events from public, anon, authenticated, service_role;

-- 7. The receipt email's read (M3.7): one payment and its invoice.
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
    'status', p.status, 'fulfillment_status', p.fulfillment_status)
  from private.payments p left join private.invoices i on i.payment_id = p.id
  where p.id = p_payment_id;
$function$;
alter function internal.get_payment_receipt(uuid) owner to postgres;
revoke all on function internal.get_payment_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.get_payment_receipt(uuid) to service_role;

CREATE OR REPLACE FUNCTION api.get_payment_receipt(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_payment_receipt(p_payment_id);
$function$;
alter function api.get_payment_receipt(uuid) owner to postgres;
revoke all on function api.get_payment_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function api.get_payment_receipt(uuid) to service_role;

commit;
