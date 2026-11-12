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
--    payment id, a reason code from a closed list, an Ozow transaction key,
--    times and, once an alert is prepared, the payment's state at that moment
--    (reference, amount, statuses, product kind). Rows go with their payment
--    when the retention sweep deletes it (on delete cascade).
-- 2. New service command api.record_payment_problem(p_payment_id, p_reason,
--    p_source, p_alert, p_transaction): the website's server records a
--    problem when it refuses a signed notice, when the status check refuses a
--    transaction or finds two successful ones, and when settlement reports an
--    outcome that needs staff. A repeat only updates the last-seen time and
--    the count. p_alert marks problems that need a person at once (the
--    website decides: a wrong amount or a second payment the bank reports
--    successful, money received for something that could not be activated,
--    money returned after activation); a later repeat can raise the mark,
--    never lower it, and the time it was raised is kept. After the alert was
--    sent, a repeat marked for an alert that names another Ozow transaction
--    (for example a third successful payment) raises it again, at most 5
--    times per problem.
-- 3. New service commands api.claim_payment_alerts(p_limit) and
--    api.complete_payment_alerts(p_claim, p_sent): the email job (every
--    minute) takes a five-minute lease on marked problems not yet emailed and
--    raised in the last 7 days, and receives each with the payment's state
--    stored when the batch was first prepared. A batch whose send failed is
--    offered again first, unchanged (same lease token, same details), so a
--    retry sends the same email. p_sent records the batch as sent, or gives
--    it back at once (p_sent false).
-- 4. New table private.payment_problem_digests and service commands
--    api.claim_payment_digest(p_from_hour, p_limit) and
--    api.complete_payment_digest(p_claim): once per South African calendar
--    day, from the given hour, the email job takes a lease on that day's
--    summary. Its content is computed at the first lease and stored, so a
--    retry gets the same summary: problems seen since the previous summary
--    (at most 7 days back), payments still waiting for staff (received but
--    not activated; pending with an Ozow request for over two hours), marked
--    problems raised in the last 7 days and not emailed yet, and the count of
--    each provider journal outcome in the same period. Summary rows older
--    than 400 days are removed when a new one starts.
-- No existing function, table, grant or API command changes, so the website
-- deployed before this update keeps working with it. The update refuses
-- (55000) if either table already exists with other columns.
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

-- Precondition: the tables are absent, or exactly this update's (a repeated run).
do $$
declare shape text;
begin
  for shape in
    select v.name||' '||coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
        ||case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid=to_regclass(v.name) and a.attnum>0 and not a.attisdropped),'absent')
    from (values ('private.payment_problems'),('private.payment_problem_digests')) v(name)
  loop
    if shape not in ('private.payment_problems absent','private.payment_problem_digests absent',
        'private.payment_problems id:uuid!,payment_id:uuid,reason:text!,source:text!,needs_alert:boolean!,'
          ||'first_seen_at:timestamp with time zone!,last_seen_at:timestamp with time zone!,occurrences:integer!,'
          ||'alert_raised_at:timestamp with time zone,alert_transaction:text,alert_rearms:integer!,alert_claim:uuid,'
          ||'alert_claimed_until:timestamp with time zone,alert_snapshot:jsonb,alerted_at:timestamp with time zone',
        'private.payment_problem_digests day:date!,claim:uuid,claimed_until:timestamp with time zone,'
          ||'window_end:timestamp with time zone,content:jsonb,done_at:timestamp with time zone') then
      raise exception 'payment problem table drift: %', shape using errcode='55000';
    end if;
  end loop;
end$$;

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
  alert_raised_at timestamptz,
  alert_transaction text check (length(alert_transaction) between 1 and 100),
  alert_rearms integer not null default 0 check (alert_rearms between 0 and 5),
  alert_claim uuid,
  alert_claimed_until timestamptz,
  alert_snapshot jsonb check (jsonb_typeof(alert_snapshot) = 'object'),
  alerted_at timestamptz,
  constraint payment_problems_once unique nulls not distinct (payment_id, reason),
  check (not needs_alert or payment_id is not null),
  check (needs_alert = (alert_raised_at is not null)),
  check (alerted_at is null or needs_alert),
  check ((alert_claim is null) = (alert_snapshot is null))
);
alter table private.payment_problems enable row level security;
revoke all on table private.payment_problems from public, anon, authenticated, service_role;
create index if not exists payment_problems_alert_due_idx on private.payment_problems (alert_raised_at)
  where needs_alert and alerted_at is null;
create index if not exists payment_problems_last_seen_idx on private.payment_problems (last_seen_at);
create index if not exists payment_problems_alert_claim_idx on private.payment_problems (alert_claim)
  where alert_claim is not null;

create table if not exists private.payment_problem_digests (
  day date primary key,
  claim uuid unique,
  claimed_until timestamptz,
  window_end timestamptz,
  content jsonb check (jsonb_typeof(content) = 'object'),
  done_at timestamptz
);
alter table private.payment_problem_digests enable row level security;
revoke all on table private.payment_problem_digests from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.record_payment_problem(p_payment_id uuid, p_reason text, p_source text, p_alert boolean, p_transaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare problem private.payment_problems; alert boolean; raise_now boolean; rearm boolean;
begin
  if p_reason is null or p_reason not in (
      'unsupported_transaction_status', 'merchant_reference_mismatch', 'site_code_mismatch',
      'test_mode_mismatch', 'missing_transaction_id', 'payment_id_mismatch', 'transaction_id_mismatch',
      'currency_mismatch', 'missing_amount', 'missing_currency', 'amount_mismatch',
      'invalid_json', 'missing_merchant_reference', 'missing_transaction_status', 'unknown_payment',
      'unknown_reference', 'request_mismatch', 'missing_transaction', 'conflicting_transaction',
      'transaction_reused', 'complete_unfulfillable_target', 'refunded_after_completion',
      'multiple_settlements')
    or p_source is null or p_source not in ('notice', 'status_check') or p_alert is null
    or length(p_transaction) not between 1 and 100 then
    raise exception 'invalid payment problem' using errcode='22023';
  end if;
  if p_payment_id is not null and not exists(select 1 from private.payments p where p.id=p_payment_id) then
    raise exception 'payment problem names no payment' using errcode='22023';
  end if;
  -- Only a problem with a known payment can be emailed about.
  alert := p_alert and p_payment_id is not null;
  insert into private.payment_problems(payment_id, reason, source, needs_alert, alert_raised_at, alert_transaction)
    values (p_payment_id, p_reason, p_source, alert, case when alert then clock_timestamp() end,
      case when alert then p_transaction end)
    on conflict on constraint payment_problems_once do nothing
    returning * into problem;
  if found then
    return jsonb_build_object('id',problem.id,'new',true,'alert',problem.needs_alert,'raised',problem.needs_alert);
  end if;
  select * into problem from private.payment_problems p
    where p.reason=p_reason
      and (p.payment_id=p_payment_id or (p_payment_id is null and p.payment_id is null))
    for update;
  -- Seen before: the first source and first time stay; the mark only rises.
  -- Once emailed, a marked repeat from another Ozow transaction raises it
  -- again (at most 5 times); the same transaction never does.
  raise_now := alert and not problem.needs_alert;
  rearm := alert and problem.needs_alert and problem.alerted_at is not null and p_transaction is not null
    and problem.alert_transaction is distinct from p_transaction and problem.alert_rearms<5;
  update private.payment_problems p set last_seen_at=clock_timestamp(),
      occurrences=least(p.occurrences,2147483646)+1,
      needs_alert=p.needs_alert or alert,
      alert_raised_at=case when raise_now or rearm then clock_timestamp() else p.alert_raised_at end,
      alert_transaction=case when raise_now or rearm then p_transaction else p.alert_transaction end,
      alert_rearms=p.alert_rearms+case when rearm then 1 else 0 end,
      alerted_at=case when rearm then null else p.alerted_at end,
      alert_claim=case when rearm then null else p.alert_claim end,
      alert_claimed_until=case when rearm then null else p.alert_claimed_until end,
      alert_snapshot=case when rearm then null else p.alert_snapshot end
    where p.id=problem.id
    returning * into problem;
  return jsonb_build_object('id',problem.id,'new',false,'alert',problem.needs_alert,'raised',raise_now or rearm);
end;
$function$;
alter function internal.record_payment_problem(uuid,text,text,boolean,text) owner to postgres;
revoke all on function internal.record_payment_problem(uuid,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function internal.record_payment_problem(uuid,text,text,boolean,text) to service_role;

CREATE OR REPLACE FUNCTION api.record_payment_problem(p_payment_id uuid, p_reason text, p_source text, p_alert boolean, p_transaction text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_payment_problem(p_payment_id, p_reason, p_source, p_alert, p_transaction);
$function$;
alter function api.record_payment_problem(uuid,text,text,boolean,text) owner to postgres;
revoke all on function api.record_payment_problem(uuid,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function api.record_payment_problem(uuid,text,text,boolean,text) to service_role;

CREATE OR REPLACE FUNCTION internal.claim_payment_alerts(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare now_at timestamptz := clock_timestamp(); token uuid; claimed jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid payment alert limit' using errcode='22023'; end if;
  -- A batch whose send failed (its lease ended or was given back) is offered
  -- again first, unchanged: same token, same rows, same stored details.
  select p.alert_claim into token from private.payment_problems p
    where p.needs_alert and p.alerted_at is null and p.alert_claim is not null
      and p.alert_claimed_until<=now_at and p.alert_raised_at>now_at-interval '7 days'
    order by p.alert_raised_at, p.id
    limit 1;
  if token is not null then
    with taken as (
      update private.payment_problems p set alert_claimed_until=now_at+interval '5 minutes'
        where p.alert_claim=token and p.needs_alert and p.alerted_at is null and p.alert_claimed_until<=now_at
        returning p.*)
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'payment_id',t.payment_id,'reason',t.reason,
        'source',t.source,'raised_at',t.alert_raised_at)||t.alert_snapshot order by t.alert_raised_at, t.id),'[]'::jsonb)
      into claimed from taken t;
  else
    -- A new batch: marked, not emailed, raised in the last 7 days and never
    -- prepared, oldest first. Rows another transaction holds are left for the
    -- next run. The payment's state is stored with each row once, here.
    token := pg_catalog.gen_random_uuid();
    with due as (
      select p.id from private.payment_problems p
      where p.needs_alert and p.alerted_at is null and p.alert_claim is null
        and p.alert_raised_at>now_at-interval '7 days'
      order by p.alert_raised_at, p.id
      limit p_limit
      for update skip locked),
    taken as (
      update private.payment_problems p set alert_claim=token,
          alert_claimed_until=now_at+interval '5 minutes',
          alert_snapshot=jsonb_build_object('merchant_reference',pay.merchant_reference,
            'amount_cents',pay.amount_cents::text,'status',pay.status,
            'fulfillment_status',pay.fulfillment_status,'product_kind',pay.product_kind)
        from due, private.payments pay
        where p.id=due.id and pay.id=p.payment_id
        returning p.*)
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'payment_id',t.payment_id,'reason',t.reason,
        'source',t.source,'raised_at',t.alert_raised_at)||t.alert_snapshot order by t.alert_raised_at, t.id),'[]'::jsonb)
      into claimed from taken t;
  end if;
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

CREATE OR REPLACE FUNCTION internal.complete_payment_alerts(p_claim uuid, p_sent boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare changed integer;
begin
  if p_claim is null or p_sent is null then
    raise exception 'invalid payment alert claim' using errcode='22023'; end if;
  if p_sent then
    update private.payment_problems set alerted_at=clock_timestamp(), alert_claimed_until=null
      where alert_claim=p_claim and alerted_at is null;
  else
    -- Given back: offered again, unchanged, on the next run.
    update private.payment_problems set alert_claimed_until=clock_timestamp()
      where alert_claim=p_claim and alerted_at is null;
  end if;
  get diagnostics changed=row_count;
  return changed;
end;
$function$;
alter function internal.complete_payment_alerts(uuid,boolean) owner to postgres;
revoke all on function internal.complete_payment_alerts(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.complete_payment_alerts(uuid,boolean) to service_role;

CREATE OR REPLACE FUNCTION api.complete_payment_alerts(p_claim uuid, p_sent boolean)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_payment_alerts(p_claim, p_sent);
$function$;
alter function api.complete_payment_alerts(uuid,boolean) owner to postgres;
revoke all on function api.complete_payment_alerts(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function api.complete_payment_alerts(uuid,boolean) to service_role;

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
  period_end timestamptz;
begin
  if p_from_hour is null or p_from_hour not between 0 and 23 or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid payment summary request' using errcode='22023'; end if;
  if extract(hour from local_now)<p_from_hour then return null; end if;
  delete from private.payment_problem_digests where day<today-400;
  insert into private.payment_problem_digests(day) values (today) on conflict (day) do nothing;
  -- The first lease fixes the period's end; a retry keeps it.
  update private.payment_problem_digests set claim=pg_catalog.gen_random_uuid(),
      claimed_until=now_at+interval '5 minutes', window_end=coalesce(window_end,now_at)
    where day=today and done_at is null and (claimed_until is null or claimed_until<=now_at)
    returning * into digest;
  if not found then return null; end if;
  if digest.content is null then
    period_end := digest.window_end;
    -- From the end of the last summary sent, at most 7 days back.
    select greatest(coalesce(max(d.window_end),period_end-interval '24 hours'),period_end-interval '7 days') into since
      from private.payment_problem_digests d where d.day<today and d.done_at is not null;
    -- Computed once and stored, so a retry sends the same summary.
    update private.payment_problem_digests set content=jsonb_build_object('day',today,
      'window_start',since,'window_end',period_end,
      'problems',(select jsonb_build_object('total',count(*),'items',coalesce((select jsonb_agg(x.item order by x.needs_alert desc, x.last_seen_at desc, x.id)
          from (select p.id, p.needs_alert, p.last_seen_at, jsonb_build_object('payment_id',p.payment_id,'reason',p.reason,
              'source',p.source,'first_seen_at',p.first_seen_at,'last_seen_at',p.last_seen_at,'occurrences',p.occurrences,
              'needs_alert',p.needs_alert,'alerted',p.alerted_at is not null) as item
            from private.payment_problems p where p.last_seen_at>since and p.last_seen_at<=period_end
            order by p.needs_alert desc, p.last_seen_at desc, p.id limit p_limit) x),'[]'::jsonb))
        from private.payment_problems p where p.last_seen_at>since and p.last_seen_at<=period_end),
      'not_activated',(select jsonb_build_object('total',count(*),'payment_ids',coalesce((select jsonb_agg(x.id order by x.completed_at, x.id)
          from (select p.id, p.completed_at from private.payments p where p.fulfillment_status='needs_reconciliation'
            order by p.completed_at, p.id limit p_limit) x),'[]'::jsonb))
        from private.payments p where p.fulfillment_status='needs_reconciliation'),
      'stale_pending',(select jsonb_build_object('total',count(*),'payment_ids',coalesce((select jsonb_agg(x.id order by x.created_at, x.id)
          from (select p.id, p.created_at from private.payments p where p.status='pending' and p.provider_request_id is not null
              and p.created_at<period_end-interval '2 hours'
            order by p.created_at, p.id limit p_limit) x),'[]'::jsonb))
        from private.payments p where p.status='pending' and p.provider_request_id is not null
          and p.created_at<period_end-interval '2 hours'),
      'unalerted',(select count(*) from private.payment_problems p where p.needs_alert and p.alerted_at is null
        and p.alert_raised_at>period_end-interval '7 days'),
      'outcomes',(select coalesce(jsonb_object_agg(o.outcome,o.total),'{}'::jsonb) from
        (select e.outcome, count(*) as total from private.provider_events e
          where e.received_at>since and e.received_at<=period_end group by e.outcome) o))
    where day=today
    returning * into digest;
  end if;
  return digest.content||jsonb_build_object('claim',digest.claim);
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
