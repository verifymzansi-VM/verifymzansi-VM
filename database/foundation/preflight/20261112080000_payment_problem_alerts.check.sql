-- Read-only preflight for updates/20261112080000_payment_problem_alerts.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says whether the update's two tables and ten commands are all
-- absent (not applied) or all present with the update's bodies (already
-- applied), and counts what the first daily payment summary will list:
-- - "paid but not activated": payments whose money was received but whose
--   plan or add-on could not be activated (fulfillment_status
--   needs_reconciliation);
-- - "pending with an Ozow request for over 2 hours".
-- Apply the update before the website release that uses it is deployed (see
-- updates/README.md).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.record_payment_problem(uuid,text,text,boolean)', '2b513a0b36a0f9b23de6731236051bee'),
    ('api.record_payment_problem(uuid,text,text,boolean)', '5676d2724dab7a2eae4c31be9277161b'),
    ('internal.claim_payment_alerts(integer)', '418ed26366183586c7f381251cf08bea'),
    ('api.claim_payment_alerts(integer)', 'cc0dafa479115c493baf59f491fd79d4'),
    ('internal.complete_payment_alerts(uuid)', '141d19ec1b949c3efa74c0563f9570cf'),
    ('api.complete_payment_alerts(uuid)', '47a83851b87b10fe5b6a65751e92a666'),
    ('internal.claim_payment_digest(integer,integer)', 'f9cad054994afaf3b6760b189a563d54'),
    ('api.claim_payment_digest(integer,integer)', 'a14ed70f57c9c3568b7e6041881f1f12'),
    ('internal.complete_payment_digest(uuid)', '6f334b442d5bc8a51f6ee4f51cf8f025'),
    ('api.complete_payment_digest(uuid)', 'f8e68e7bcd1992fb2844d875d3f4bf94')
  ) v(sig, updated)
),
tables as (
  select v.name, to_regclass(v.name) is not null as present
  from (values ('private.payment_problems'), ('private.payment_problem_digests')) v(name)
),
state as (
  select
    (select count(*) from bodies where body is null) + (select count(*) from tables where not present) as absent,
    (select count(*) from bodies where body = updated) + (select count(*) from tables where present) as updated,
    (select count(*) from bodies) + (select count(*) from tables) as total
),
problems as (
  select 'problem' as kind, sig || ' is not the update''s body (md5 ' || body || '); do not apply the update' as detail
    from bodies where body is not null and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from bodies where body is not null and body is distinct from updated)
)
select 'summary' as kind,
  'payment problem alerts: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; paid but not activated: '
    || (select count(*) from private.payments where fulfillment_status = 'needs_reconciliation')
    || '; pending with an Ozow request for over 2 hours: '
    || (select count(*) from private.payments where status = 'pending' and provider_request_id is not null
          and created_at < clock_timestamp() - interval '2 hours') as detail
from state s
union all
select kind, detail from problems;
