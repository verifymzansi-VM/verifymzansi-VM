-- Reviewed rollback for updates/20261121090305_staff_sales_and_vat.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. The website release that reads
-- the new commands then shows "Sales figures could not be loaded" on the staff
-- payments page and leaves the VAT line out of the public pages; the daily
-- payment summary is sent without its sales line.
-- The rollback puts back internal.claim_payment_digest byte for byte (its
-- body from 20261112080000) and drops api.get_staff_sales_summary,
-- api.get_vat_registration, their internal twins,
-- internal.vat_sales_position and internal.payment_net_cents. Summaries
-- already stored keep their 'sales' field; nothing else is touched.
-- It refuses (55000) unless every function it replaces or drops still has the
-- update's body and no other function uses what it drops, so a later update
-- that changed one of them is never undone silently.
begin;
set local lock_timeout='5s';

do $$
declare drift text; callers text;
begin
  if to_regprocedure('api.get_staff_sales_summary()') is null
    or to_regprocedure('internal.vat_sales_position()') is null then
    raise exception 'rollback precondition: the staff sales update is not applied' using errcode='55000';
  end if;
  select string_agg(v.sig, ', ' order by v.sig) into drift
  from (values
    ('internal.claim_payment_digest(integer,integer)', 'a512218f46687b0913fa0c49228fede4'),
    ('internal.payment_net_cents(private.payments)', '28d85be00f5d30c0f2121b120ea55dc9'),
    ('internal.vat_sales_position()', '87d7738f16d38f1ef6bd523fa7d34888'),
    ('internal.get_staff_sales_summary()', 'dd9f4b3f0f4782b818a735bdc2f13a2e'),
    ('api.get_staff_sales_summary()', '8eb614811b615aeda5e06f4f045ef18a'),
    ('internal.get_vat_registration()', '923498193777b09fdbc938b56e6247c2'),
    ('api.get_vat_registration()', '49b7012d8d0c514c280404290243b484')
  ) v(sig, updated)
  where (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig))
    is distinct from v.updated;
  if drift is not null then
    raise exception 'rollback precondition: changed since the update: %', drift using errcode='55000';
  end if;
  -- Only the update's own functions use what this rollback drops (exact
  -- text, so an underscore is not a wildcard).
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into callers
  from pg_proc p
  where (strpos(p.prosrc, 'internal.payment_net_cents') > 0
      or strpos(p.prosrc, 'internal.vat_sales_position') > 0
      or strpos(p.prosrc, 'internal.get_staff_sales_summary') > 0
      or strpos(p.prosrc, 'internal.get_vat_registration') > 0)
    and p.oid not in (
      to_regprocedure('internal.claim_payment_digest(integer,integer)'),
      to_regprocedure('internal.vat_sales_position()'),
      to_regprocedure('internal.get_staff_sales_summary()'),
      to_regprocedure('api.get_staff_sales_summary()'),
      to_regprocedure('api.get_vat_registration()'));
  if callers is not null then
    raise exception 'rollback precondition: other functions use what the rollback drops: %', callers using errcode='55000';
  end if;
end$$;

-- PUT BACK: internal.claim_payment_digest as 20261112080000 wrote it.
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

drop function api.get_staff_sales_summary();
drop function internal.get_staff_sales_summary();
drop function api.get_vat_registration();
drop function internal.get_vat_registration();
drop function internal.vat_sales_position();
drop function internal.payment_net_cents(private.payments);

notify pgrst,'reload schema';
commit;
