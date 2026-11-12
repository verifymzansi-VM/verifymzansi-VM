-- Payment problems are kept and staff are emailed about them.
--
-- Until now a payment notice or status check that could not be applied was
-- only written to the website's log, and settlement outcomes that need a
-- person (a second payment, money for something that could not be activated)
-- only to the provider journal (private.provider_events). Nothing told staff.
--
-- From this update:
-- 1. New table private.payment_problems: one row per payment and problem
--    reason (one row per reason for notices that name no known payment), with
--    where it was first found (the signed notice or the status check), when it
--    was first and last seen and how often. It holds no personal data: the
--    payment id, a reason code from a closed list, and times. Rows go with
--    their payment when the retention sweep deletes it (on delete cascade).
-- 2. New service command api.record_payment_problem(p_payment_id, p_reason,
--    p_source, p_alert): the website's server records a problem when it
--    refuses a signed notice, when the status check refuses a transaction or
--    finds two successful ones, and when settlement reports an outcome that
--    needs staff. A repeat only updates the last-seen time and the count.
--    p_alert marks problems that need a person at once (the website decides:
--    a wrong amount, a second payment, money received for something that
--    could not be activated, money returned after activation); a later repeat
--    can raise the mark, never lower it.
-- 3. New service commands api.claim_payment_alerts(p_limit) and
--    api.complete_payment_alerts(p_claim): the email job (every minute) takes
--    a five-minute lease on marked problems not yet emailed, first seen in
--    the last 7 days, sends one email listing them, and records them as sent.
--    A failed send leaves them for the next lease.
-- 4. New table private.payment_problem_digests and service commands
--    api.claim_payment_digest(p_from_hour, p_limit) and
--    api.complete_payment_digest(p_claim): once per South African calendar
--    day, from the given hour, the email job takes a lease on that day's
--    summary and receives what it lists: problems seen since the previous
--    summary (at most 7 days back), payments still waiting for staff
--    (received but not activated), payments pending with an Ozow request for
--    over two hours, marked problems not yet emailed, and the count of each
--    provider journal outcome in the same window. Summary rows older than
--    400 days are removed when a new one starts.
-- No existing function, table, grant or API command changes, so the website
-- deployed before this update keeps working with it.
--
-- ORDER: apply this update BEFORE the website release that uses it (the pull
-- request that adds this file) is deployed: that release records problems and
-- its email job claims alerts with these commands. Without them it still
-- settles payments and sends every other email, but it logs a failure for
-- each problem it cannot record and its email job run reports the payment
-- alert steps as failed.
-- Read-only preflight:
-- ../preflight/20261112080000_payment_problem_alerts.check.sql.
-- Rollback: ../rollback/20261112080000_payment_problem_alerts.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

create table if not exists private.payment_problems (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  payment_id uuid references private.payments (id) on delete cascade,
  reason text not null check (reason in (
    'unsupported_transaction_status', 'merchant_reference_mismatch', 'site_code_mismatch',
    'test_mode_mismatch', 'missing_transaction_id', 'payment_id_mismatch', 'transaction_id_mismatch',
    'currency_mismatch', 'missing_amount', 'missing_currency', 'amount_mismatch',
    'invalid_json', 'missing_merchant_reference', 'missing_transaction_status', 'unknown_payment',
    'unknown_reference', 'request_mismatch', 'missing_transaction', 'conflicting_transaction',
    'transaction_reused', 'complete_unfulfillable_target', 'refunded_after_completion',
    'multiple_settlements')),
  source text not null check (source in ('notice', 'status_check')),
  needs_alert boolean not null default false,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  occurrences integer not null default 1 check (occurrences >= 1),
  alert_claim uuid,
  alert_claimed_until timestamptz,
  alerted_at timestamptz,
  constraint payment_problems_once unique nulls not distinct (payment_id, reason),
  check (not needs_alert or payment_id is not null),
  check (alerted_at is null or needs_alert)
);
alter table private.payment_problems enable row level security;
revoke all on table private.payment_problems from public, anon, authenticated, service_role;
create index if not exists payment_problems_alert_due_idx on private.payment_problems (first_seen_at)
  where needs_alert and alerted_at is null;
create index if not exists payment_problems_last_seen_idx on private.payment_problems (last_seen_at);
create index if not exists payment_problems_alert_claim_idx on private.payment_problems (alert_claim)
  where alert_claim is not null;

create table if not exists private.payment_problem_digests (
  day date primary key,
  claim uuid unique,
  claimed_until timestamptz,
  window_end timestamptz,
  done_at timestamptz
);
alter table private.payment_problem_digests enable row level security;
revoke all on table private.payment_problem_digests from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.record_payment_problem(p_payment_id uuid, p_reason text, p_source text, p_alert boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare problem private.payment_problems; alert boolean;
begin
  if p_reason is null or p_reason not in (
      'unsupported_transaction_status', 'merchant_reference_mismatch', 'site_code_mismatch',
      'test_mode_mismatch', 'missing_transaction_id', 'payment_id_mismatch', 'transaction_id_mismatch',
      'currency_mismatch', 'missing_amount', 'missing_currency', 'amount_mismatch',
      'invalid_json', 'missing_merchant_reference', 'missing_transaction_status', 'unknown_payment',
      'unknown_reference', 'request_mismatch', 'missing_transaction', 'conflicting_transaction',
      'transaction_reused', 'complete_unfulfillable_target', 'refunded_after_completion',
      'multiple_settlements')
    or p_source is null or p_source not in ('notice', 'status_check') or p_alert is null then
    raise exception 'invalid payment problem' using errcode='22023';
  end if;
  if p_payment_id is not null and not exists(select 1 from private.payments p where p.id=p_payment_id) then
    raise exception 'payment problem names no payment' using errcode='22023';
  end if;
  -- Only a problem with a known payment can be emailed about.
  alert := p_alert and p_payment_id is not null;
  insert into private.payment_problems(payment_id, reason, source, needs_alert)
    values (p_payment_id, p_reason, p_source, alert)
    on conflict on constraint payment_problems_once do nothing
    returning * into problem;
  if found then
    return jsonb_build_object('id',problem.id,'new',true,'alert',problem.needs_alert);
  end if;
  -- Seen before: the first source and first time stay; the mark only rises.
  update private.payment_problems p set last_seen_at=clock_timestamp(),
      occurrences=least(p.occurrences,2147483646)+1, needs_alert=p.needs_alert or alert
    where p.reason=p_reason
      and (p.payment_id=p_payment_id or (p_payment_id is null and p.payment_id is null))
    returning * into problem;
  return jsonb_build_object('id',problem.id,'new',false,'alert',coalesce(problem.needs_alert,false));
end;
$function$;
alter function internal.record_payment_problem(uuid,text,text,boolean) owner to postgres;
revoke all on function internal.record_payment_problem(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.record_payment_problem(uuid,text,text,boolean) to service_role;

CREATE OR REPLACE FUNCTION api.record_payment_problem(p_payment_id uuid, p_reason text, p_source text, p_alert boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_payment_problem(p_payment_id, p_reason, p_source, p_alert);
$function$;
alter function api.record_payment_problem(uuid,text,text,boolean) owner to postgres;
revoke all on function api.record_payment_problem(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function api.record_payment_problem(uuid,text,text,boolean) to service_role;

CREATE OR REPLACE FUNCTION internal.claim_payment_alerts(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare token uuid := pg_catalog.gen_random_uuid(); claimed jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid payment alert limit' using errcode='22023'; end if;
  -- Marked, not emailed, first seen in the last 7 days and not leased now,
  -- oldest first. Rows another transaction holds are left for the next run.
  with due as (
    select p.id from private.payment_problems p
    where p.needs_alert and p.alerted_at is null
      and p.first_seen_at>clock_timestamp()-interval '7 days'
      and (p.alert_claimed_until is null or p.alert_claimed_until<=clock_timestamp())
    order by p.first_seen_at, p.id
    limit p_limit
    for update skip locked),
  taken as (
    update private.payment_problems p set alert_claim=token,
        alert_claimed_until=clock_timestamp()+interval '5 minutes'
      from due where p.id=due.id
      returning p.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'payment_id',t.payment_id,'reason',t.reason,
      'source',t.source,'first_seen_at',t.first_seen_at,'merchant_reference',pay.merchant_reference,
      'amount_cents',pay.amount_cents::text,'status',pay.status,'fulfillment_status',pay.fulfillment_status,
      'product_kind',pay.product_kind) order by t.first_seen_at, t.id),'[]'::jsonb)
    into claimed
    from taken t join private.payments pay on pay.id=t.payment_id;
  return jsonb_build_object('claim',case when jsonb_array_length(claimed)=0 then null else token end,
    'problems',claimed);
end;
$function$;
alter function internal.claim_payment_alerts(integer) owner to postgres;
revoke all on function internal.claim_payment_alerts(integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_payment_alerts(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_payment_alerts(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_payment_alerts(p_limit);
$function$;
alter function api.claim_payment_alerts(integer) owner to postgres;
revoke all on function api.claim_payment_alerts(integer) from public,anon,authenticated,service_role;
grant execute on function api.claim_payment_alerts(integer) to service_role;

CREATE OR REPLACE FUNCTION internal.complete_payment_alerts(p_claim uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare sent integer;
begin
  if p_claim is null then raise exception 'invalid payment alert claim' using errcode='22023'; end if;
  update private.payment_problems set alerted_at=clock_timestamp(), alert_claimed_until=null
    where alert_claim=p_claim and alerted_at is null;
  get diagnostics sent=row_count;
  return sent;
end;
$function$;
alter function internal.complete_payment_alerts(uuid) owner to postgres;
revoke all on function internal.complete_payment_alerts(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.complete_payment_alerts(uuid) to service_role;

CREATE OR REPLACE FUNCTION api.complete_payment_alerts(p_claim uuid)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_payment_alerts(p_claim);
$function$;
alter function api.complete_payment_alerts(uuid) owner to postgres;
revoke all on function api.complete_payment_alerts(uuid) from public,anon,authenticated,service_role;
grant execute on function api.complete_payment_alerts(uuid) to service_role;

CREATE OR REPLACE FUNCTION internal.claim_payment_digest(p_from_hour integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  now_at timestamptz := clock_timestamp();
  local_now timestamp := clock_timestamp() at time zone 'Africa/Johannesburg';
  today date := (clock_timestamp() at time zone 'Africa/Johannesburg')::date;
  digest private.payment_problem_digests;
  since timestamptz;
begin
  if p_from_hour is null or p_from_hour not between 0 and 23 or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid payment summary request' using errcode='22023'; end if;
  if extract(hour from local_now)<p_from_hour then return null; end if;
  delete from private.payment_problem_digests where day<today-400;
  insert into private.payment_problem_digests(day) values (today) on conflict (day) do nothing;
  update private.payment_problem_digests set claim=pg_catalog.gen_random_uuid(),
      claimed_until=now_at+interval '5 minutes', window_end=now_at
    where day=today and done_at is null and (claimed_until is null or claimed_until<=now_at)
    returning * into digest;
  if not found then return null; end if;
  -- From the end of the last summary sent, at most 7 days back.
  select greatest(coalesce(max(d.window_end),now_at-interval '24 hours'),now_at-interval '7 days') into since
    from private.payment_problem_digests d where d.day<today and d.done_at is not null;
  return jsonb_build_object('day',today,'claim',digest.claim,'window_start',since,'window_end',now_at,
    'problems',(select jsonb_build_object('total',count(*),'items',coalesce((select jsonb_agg(x.item order by x.needs_alert desc, x.last_seen_at desc, x.id)
        from (select p.id, p.needs_alert, p.last_seen_at, jsonb_build_object('payment_id',p.payment_id,'reason',p.reason,
            'source',p.source,'first_seen_at',p.first_seen_at,'last_seen_at',p.last_seen_at,'occurrences',p.occurrences,
            'needs_alert',p.needs_alert,'alerted',p.alerted_at is not null) as item
          from private.payment_problems p where p.last_seen_at>since and p.last_seen_at<=now_at
          order by p.needs_alert desc, p.last_seen_at desc, p.id limit p_limit) x),'[]'::jsonb))
      from private.payment_problems p where p.last_seen_at>since and p.last_seen_at<=now_at),
    'not_activated',(select jsonb_build_object('total',count(*),'payment_ids',coalesce((select jsonb_agg(x.id order by x.completed_at, x.id)
        from (select p.id, p.completed_at from private.payments p where p.fulfillment_status='needs_reconciliation'
          order by p.completed_at, p.id limit p_limit) x),'[]'::jsonb))
      from private.payments p where p.fulfillment_status='needs_reconciliation'),
    'stale_pending',(select jsonb_build_object('total',count(*),'payment_ids',coalesce((select jsonb_agg(x.id order by x.created_at, x.id)
        from (select p.id, p.created_at from private.payments p where p.status='pending' and p.provider_request_id is not null
            and p.created_at<now_at-interval '2 hours'
          order by p.created_at, p.id limit p_limit) x),'[]'::jsonb))
      from private.payments p where p.status='pending' and p.provider_request_id is not null
        and p.created_at<now_at-interval '2 hours'),
    'unalerted',(select count(*) from private.payment_problems p where p.needs_alert and p.alerted_at is null),
    'outcomes',(select coalesce(jsonb_object_agg(o.outcome,o.total),'{}'::jsonb) from
      (select e.outcome, count(*) as total from private.provider_events e
        where e.received_at>since and e.received_at<=now_at group by e.outcome) o));
end;
$function$;
alter function internal.claim_payment_digest(integer,integer) owner to postgres;
revoke all on function internal.claim_payment_digest(integer,integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_payment_digest(integer,integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_payment_digest(p_from_hour integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_payment_digest(p_from_hour, p_limit);
$function$;
alter function api.claim_payment_digest(integer,integer) owner to postgres;
revoke all on function api.claim_payment_digest(integer,integer) from public,anon,authenticated,service_role;
grant execute on function api.claim_payment_digest(integer,integer) to service_role;

CREATE OR REPLACE FUNCTION internal.complete_payment_digest(p_claim uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_claim is null then raise exception 'invalid payment summary claim' using errcode='22023'; end if;
  update private.payment_problem_digests set done_at=clock_timestamp(), claimed_until=null
    where claim=p_claim and done_at is null;
  return found;
end;
$function$;
alter function internal.complete_payment_digest(uuid) owner to postgres;
revoke all on function internal.complete_payment_digest(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.complete_payment_digest(uuid) to service_role;

CREATE OR REPLACE FUNCTION api.complete_payment_digest(p_claim uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_payment_digest(p_claim);
$function$;
alter function api.complete_payment_digest(uuid) owner to postgres;
revoke all on function api.complete_payment_digest(uuid) from public,anon,authenticated,service_role;
grant execute on function api.complete_payment_digest(uuid) to service_role;
commit;
