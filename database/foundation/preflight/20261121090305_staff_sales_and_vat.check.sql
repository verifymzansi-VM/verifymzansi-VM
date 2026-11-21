-- Read-only preflight for updates/20261121090305_staff_sales_and_vat.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the daily payment summary command has its reviewed
-- body and the update's six functions are absent (update not applied), or
-- everything is the update's (already applied). After the update it also
-- gives the VAT setting the website now shows.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.claim_payment_digest(integer,integer)', '4b00aeccb8a082bf08f8e4c189bf47cf', 'a512218f46687b0913fa0c49228fede4'),
    -- Added by the update.
    ('internal.payment_net_cents(private.payments)', null, '28d85be00f5d30c0f2121b120ea55dc9'),
    ('internal.vat_sales_position()', null, '87d7738f16d38f1ef6bd523fa7d34888'),
    ('internal.get_staff_sales_summary()', null, 'dd9f4b3f0f4782b818a735bdc2f13a2e'),
    ('api.get_staff_sales_summary()', null, '8eb614811b615aeda5e06f4f045ef18a'),
    ('internal.get_vat_registration()', null, '923498193777b09fdbc938b56e6247c2'),
    ('api.get_vat_registration()', null, '49b7012d8d0c514c280404290243b484')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
)
select 'summary' as kind,
  'staff sales and VAT: '
    || case when s.updated = s.total then 'already applied; VAT setting: '
           || coalesce((select c.registration_status from private.invoice_merchant_config c where c.singleton), 'missing')
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end as detail
from state s
union all
select 'problem', sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update'
  from bodies where body is distinct from reviewed and body is distinct from updated
union all
select 'problem', 'only part of the update is present'
  from state s
  where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
    and s.reviewed <> s.total and s.updated <> s.total;
