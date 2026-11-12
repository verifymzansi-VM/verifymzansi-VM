-- Read-only preflight for updates/20261112174600_individual_slots_r69.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (the six functions it
-- replaces have their reviewed earlier bodies, its new commands and tables are
-- absent) or applied (every body is the update's), and shows the current
-- posting terms version (posting-v4 is required), the plans on sale (nothing
-- before the update; exactly the three Individual slot plans after it), plan
-- payments still pending and, once applied, the number of slot payment lines.
do $$begin
  set transaction read only;
end$$;
with changed as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.start_checkout(uuid,uuid)', 'fc1a267e98115680f867a98a3669abf7', '730791aa633108ff890a12d76eb8149c'),
    ('internal.apply_provider_event(jsonb)', '3b24cc0a39de855c0d1be3695654dc92', '8a226003da741381225c11dfd1e44308'),
    ('internal.activate_post(uuid)', '363671160e333cb9f8580bc3a883c74c', 'd9dd75c96dd1cce5b490eaafffe308be'),
    ('internal.reverse_payment(uuid,text,text)', '1beb792cd6681782bcb75d4ee8d207a0', '66005adb9e06b17e689dbac47ce93d5a'),
    ('internal.payment_partner_commission()', '18e360e40190e49a3b4883ec1d5b1e36', '98a544c767ef4aeac648bc6d387a4a18'),
    ('internal.partner_commission_guard()', 'a3d9e80674efaf8446a1cf89a2cc3805', 'ddab4845789fef80739183deeaf75e4d')
  ) v(sig, before, after)
),
added as (
  select v.sig, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.payment_line_guard()', 'b15e1db8b48ae9de6b4372ecef62ceed'),
    ('internal.individual_slot_limit_guard()', '1af83fc4a5bd4555a8b99412f8acc5f1'),
    ('internal.individual_slot_plan(text)', 'c0c1d06dc52122641d02db6b1364be75'),
    ('internal.individual_slot_identity(uuid)', '4e4552c83cb629e96f1300060eeff16b'),
    ('internal.individual_slot_limit(text)', '90ecd5c02572cc9831468458f3ae0e2d'),
    ('internal.individual_slots_counted(text,uuid,uuid)', '55a1c8d0c62efce386f1b9a9751ffd5c'),
    ('internal.individual_slot_business_checked(uuid)', 'e4f858e82e99bf3d1a62ea0b0c2d2820'),
    ('internal.start_slot_checkout(uuid,integer,bigint,boolean)', 'cb717efa522b6fe372c22e8310fdb75b'),
    ('api.start_slot_checkout(uuid,integer,bigint,boolean)', 'b9089234d615e837ba75d31f42b8f7bf'),
    ('internal.record_staff_slot_reversal(uuid,text,text)', 'ee3d342565f07d3b18ba26ac237eeab3'),
    ('api.record_staff_slot_reversal(uuid,text,text)', '2a52fbde1bcd5076472a92751af0bedb'),
    ('internal.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text)', '8713fe5cfb21326c8fe0c4e4d680e1f4'),
    ('api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text)', '92da468af327632f8d1f4cba716642c9'),
    ('internal.get_my_slots()', '6e3a3149cf2576ae2d66ab085cc8da58'),
    ('api.get_my_slots()', '0f06e8bc211c4506dae9744479d4dbdf')
  ) v(sig, after)
),
tables as (
  select v.name, to_regclass(v.name) is not null as present
  from (values ('private.payment_lines'), ('private.individual_slot_limits')) v(name)
),
state as (
  select
    (select count(*) from changed where body = before) + (select count(*) from added where body is null)
      + (select count(*) from tables where not present) as absent,
    (select count(*) from changed where body = after) + (select count(*) from added where body = after)
      + (select count(*) from tables where present) as updated,
    (select count(*) from changed) + (select count(*) from added) + (select count(*) from tables) as total
),
terms as (
  select coalesce((select c.version from private.posting_terms_current c where c.singleton), 'missing') as version
),
on_sale as (
  select coalesce(string_agg(v.plan_code || '@' || v.version || ' ' || v.price_cents || ' cents', ', '
    order by v.duration_days, v.plan_code), 'nothing') as plans,
    count(*) filter (where v.plan_code not in ('individual_30d', 'individual_90d', 'individual_180d')) as others
  from private.plan_versions v where v.is_public and v.retired_at is null
),
problems as (
  select 'problem' as kind, sig || ' is neither the reviewed body before the update nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from changed where body is distinct from before and body is distinct from after
  union all
  select 'problem', sig || ' is not the update''s body (md5 ' || body || '); do not apply the update'
    from added where body is not null and body is distinct from after
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from changed where body is distinct from before and body is distinct from after)
      and not exists (select 1 from added where body is not null and body is distinct from after)
  union all
  select 'problem', 'current posting terms are ' || t.version
      || '; apply 20261112173841_switch_posting_terms_v4.sql first'
    from terms t where t.version <> 'posting-v4'
  union all
  select 'problem', 'another plan is on sale: ' || o.plans from on_sale o where o.others > 0
)
select 'summary' as kind,
  'individual slots: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; current posting terms: ' || (select version from terms)
    || '; on sale: ' || (select plans from on_sale)
    || '; plan payments pending: '
    || (select count(*) from private.payments where product_kind = 'plan' and status = 'pending')
    || '; slot payment lines: '
    || case when to_regclass('private.payment_lines') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml('select count(*) as n from private.payment_lines', false, true, '')))[1]::text
       end as detail
from state s
union all
select kind, detail from problems;
