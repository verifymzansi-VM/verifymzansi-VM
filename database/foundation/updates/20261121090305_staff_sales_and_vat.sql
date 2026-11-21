-- Staff sales figures and the VAT wording from the database setting (launch
-- checklist item 16, roadmap M8.7 remainder).
--
-- VerifyMzansi is not registered for VAT. Registration becomes compulsory once
-- taxable sales pass R2.3 million in any 12 months (SARS, from 1 April 2026).
-- Staff need to see that coming, and the public pages should state the VAT
-- status the database holds (private.invoice_merchant_config, the setting the
-- invoices already check) instead of a fixed sentence in the website.
--
-- Everything is computed from existing payment records; no table is added.
-- A payment's sale is its amount, minus the slots refunded or charged back
-- (reversed payment lines), and nothing when the whole payment was refunded or
-- charged back. It counts on the day it was paid (completed_at), the way a
-- sales report counts an order on its order date.
--
-- From this update:
-- 1. internal.payment_net_cents(payment): that net amount, in cents.
-- 2. internal.vat_sales_position(): the rolling 12-month sales total (payments
--    paid in the last 12 months, net of refunds), the VAT setting, the alert
--    level (R1.8 million) and the compulsory level (R2.3 million), and whether
--    the alert is on: not registered for VAT and the total at or above
--    R1.8 million. No account data.
-- 3. New staff read api.get_staff_sales_summary() (internal twin): staff with
--    payments:view (the staff payments page's own capability, with a recent
--    authenticator code like every staff command). Read only. It returns the
--    VAT position (2), sales of the last 12 months by product (Individual
--    slot, Multi-listing package, add-on, other) and term in days, and the
--    online checkouts started in the last 30 days with how many were paid,
--    failed, cancelled, expired or are still open. Counts and amounts only.
-- 4. New public read api.get_vat_registration() (internal twin), for visitors
--    and members like the price catalogue: the VAT setting's status
--    ('not_registered', 'registered' or 'undecided') and, when registered, the
--    VAT number (which a VAT invoice must show anyway). Nothing else.
-- 5. internal.claim_payment_digest (the daily staff payment summary, service
--    only) keeps its signature and grants; the summary it stores gains one
--    field, 'sales', with the VAT position (2). The website reads the summary
--    with a non-strict reader, so a website deployed before this update keeps
--    sending it unchanged.
--
-- New commands and one added summary field only. ORDER: apply first, then
-- merge, as usual: until the update is applied, the website release that uses
-- it shows "Sales figures could not be loaded" on the staff payments page and
-- leaves the VAT line out of the public pages.
-- Read-only preflight: ../preflight/20261121090305_staff_sales_and_vat.check.sql.
-- Rollback: ../rollback/20261121090305_staff_sales_and_vat.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: none of the update's functions exist yet, or all of them do,
-- and the daily summary command has its reviewed body (or this update's).
do $$
declare present integer; body text;
begin
  select (to_regprocedure('internal.payment_net_cents(private.payments)') is not null)::integer
    + (to_regprocedure('internal.vat_sales_position()') is not null)::integer
    + (to_regprocedure('internal.get_staff_sales_summary()') is not null)::integer
    + (to_regprocedure('api.get_staff_sales_summary()') is not null)::integer
    + (to_regprocedure('internal.get_vat_registration()') is not null)::integer
    + (to_regprocedure('api.get_vat_registration()') is not null)::integer
  into present;
  if present not in (0, 6) then
    raise exception 'staff sales precondition: % of 6 functions exist', present using errcode='55000';
  end if;
  if to_regclass('private.invoice_merchant_config') is null then
    raise exception 'staff sales precondition: the VAT setting table is missing' using errcode='55000';
  end if;
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid = to_regprocedure('internal.claim_payment_digest(integer,integer)');
  if body is distinct from '4b00aeccb8a082bf08f8e4c189bf47cf'
      and body is distinct from 'a512218f46687b0913fa0c49228fede4' then
    raise exception 'staff sales drift: internal.claim_payment_digest is not the reviewed body (md5 %)',
      coalesce(body, 'missing') using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.payment_net_cents(p private.payments)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- What the payment brought in: nothing once the whole payment was refunded
  -- or charged back, else its amount less its reversed slots.
  select case when p.status in ('refunded', 'chargeback') then 0::bigint
    else greatest(p.amount_cents - coalesce((select sum(l.amount_cents) from private.payment_lines l
      where l.payment_id = p.id and l.status = 'reversed'), 0), 0)::bigint end;
$function$;
alter function internal.payment_net_cents(private.payments) owner to postgres;
revoke all on function internal.payment_net_cents(private.payments) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.vat_sales_position()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Sales of the last 12 months against the VAT registration levels: an
  -- early alert at R1.8 million, compulsory registration at R2.3 million.
  with paid as (
    select internal.payment_net_cents(p) as net from private.payments p
    where p.status in ('complete', 'refunded', 'chargeback')
      and p.completed_at > statement_timestamp() - interval '12 months'
  ), totals as (
    select count(*) as payments, coalesce(sum(net), 0)::bigint as net_cents from paid
  ), setting as (
    select coalesce((select c.registration_status from private.invoice_merchant_config c where c.singleton),
      'undecided') as vat_status
  )
  select jsonb_build_object('since', statement_timestamp() - interval '12 months',
    'payments', t.payments, 'net_cents', t.net_cents, 'vat_status', s.vat_status,
    'alert_cents', 180000000, 'compulsory_cents', 230000000,
    'alert', s.vat_status <> 'registered' and t.net_cents >= 180000000)
  from totals t, setting s;
$function$;
alter function internal.vat_sales_position() owner to postgres;
revoke all on function internal.vat_sales_position() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.get_staff_sales_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('payments:view'); now_at timestamptz := statement_timestamp();
  result jsonb;
begin
  select jsonb_build_object(
    'generated_at', now_at,
    'vat', internal.vat_sales_position(),
    -- Payments paid in the last 12 months, by product and term, net of refunds.
    'products', (select coalesce(jsonb_agg(jsonb_build_object('category', g.category,
        'term_days', g.term_days, 'payments', g.payments, 'net_cents', g.net_cents)
        order by g.net_cents desc, g.category, g.term_days), '[]'::jsonb)
      from (select x.category, x.term_days, count(*) as payments, sum(x.net)::bigint as net_cents
        from (select internal.payment_net_cents(p) as net,
            case when p.product_kind = 'addon' then 'add_on'
              when internal.slot_package_plan(v.plan_code) then 'package'
              when left(v.plan_code, 11) = 'individual_' then 'individual'
              else 'other' end as category,
            v.duration_days as term_days
          from private.payments p left join private.plan_versions v on v.id = p.plan_version_id
          where p.status in ('complete', 'refunded', 'chargeback')
            and p.completed_at > now_at - interval '12 months') x
        group by x.category, x.term_days) g),
    -- Online (Ozow) checkouts started in the last 30 days and how each ended.
    'checkouts', (select jsonb_build_object('days', 30, 'started', count(*),
        'paid', count(*) filter (where p.status in ('complete', 'refunded', 'chargeback')),
        'failed', count(*) filter (where p.status = 'failed'),
        'cancelled', count(*) filter (where p.status = 'cancelled'),
        'expired', count(*) filter (where p.status = 'expired'),
        'open', count(*) filter (where p.status = 'pending'))
      from private.payments p where p.provider = 'ozow' and p.created_at > now_at - interval '30 days'))
  into result;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_sales_summary() owner to postgres;
revoke all on function internal.get_staff_sales_summary() from public,anon,authenticated,service_role;
grant execute on function internal.get_staff_sales_summary() to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_sales_summary()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_sales_summary();
$function$;
alter function api.get_staff_sales_summary() owner to postgres;
revoke all on function api.get_staff_sales_summary() from public,anon,authenticated,service_role;
grant execute on function api.get_staff_sales_summary() to authenticated;

CREATE OR REPLACE FUNCTION internal.get_vat_registration()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  -- The VAT setting the invoices check; the number only when registered.
  select jsonb_build_object('status', coalesce(c.registration_status, 'undecided'),
    'vat_number', case when c.registration_status = 'registered' then btrim(c.vat_number) end)
  from (select true as singleton) s
    left join private.invoice_merchant_config c on c.singleton = s.singleton;
$function$;
alter function internal.get_vat_registration() owner to postgres;
revoke all on function internal.get_vat_registration() from public,anon,authenticated,service_role;
grant execute on function internal.get_vat_registration() to anon;
grant execute on function internal.get_vat_registration() to authenticated;

CREATE OR REPLACE FUNCTION api.get_vat_registration()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_vat_registration();
$function$;
alter function api.get_vat_registration() owner to postgres;
revoke all on function api.get_vat_registration() from public,anon,authenticated,service_role;
grant execute on function api.get_vat_registration() to anon;
grant execute on function api.get_vat_registration() to authenticated;

-- REPLACE: internal.claim_payment_digest (20261112080000). Unchanged except
-- the stored summary's new 'sales' field.
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
          where e.received_at>since and e.received_at<=period_end group by e.outcome) o),
      -- 20261121090305: the rolling 12-month sales and the VAT alert.
      'sales',internal.vat_sales_position())
    where day=today
    returning * into digest;
  end if;
  return digest.content||jsonb_build_object('claim',digest.claim);
end;
$function$;
alter function internal.claim_payment_digest(integer,integer) owner to postgres;
revoke all on function internal.claim_payment_digest(integer,integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_payment_digest(integer,integer) to service_role;

notify pgrst,'reload schema';
commit;
