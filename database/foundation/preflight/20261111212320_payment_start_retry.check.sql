-- Read-only preflight for updates/20261111212320_payment_start_retry.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says whether the checkout lease is the reviewed body and the
-- update's sweep command is absent (the update adds it), or everything is
-- already the update's, and counts:
-- - "pending without an Ozow request": pending payments no request was ever
--   attached to (a first call to Ozow failed, or is running right now);
-- - "of which the sweep will expire": those created over an hour ago and not
--   leased now, which the payment status job's first run after the website
--   release marks expired.
-- Apply the update before the website release that uses it is deployed (see
-- updates/README.md).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.claim_checkout_request(uuid,uuid)', 'beae8fd49a3fabe4d4f80264ab4e09b4', 'd29afcd49f72e712602914d6ecb4d8f5'),
    ('internal.expire_stale_checkouts(integer)', null, '10861cf1c5a94cf00d6358216321ae4e'),
    ('api.expire_stale_checkouts(integer)', null, '463872f511505e0b3ba84e0781814af0')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state where reviewed <> total and updated <> total
      and not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
)
select 'summary' as kind,
  'payment start retry: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'reviewed bodies, update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; pending without an Ozow request: '
    || (select count(*) from private.payments where status = 'pending' and provider_request_id is null)
    || '; of which the sweep will expire: '
    || (select count(*) from private.payments where status = 'pending' and provider_request_id is null
          and checkout_url is null and created_at < clock_timestamp() - interval '1 hour'
          and (checkout_claim_until is null or checkout_claim_until <= clock_timestamp())) as detail
from state s
union all
select kind, detail from problems;
