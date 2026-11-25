-- Read-only preflight for updates/20261125044115_retire_paid_addons.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.billing_catalogue, internal.get_my_billing
-- and internal.get_my_frontend_post_manager have the reviewed bodies (update
-- not applied) or the update's (already applied), and counts:
-- - "add-on versions on sale": add-on versions not retired (3 before the
--   update, 0 after);
-- - "add-on payments": add-on payments on record by status: pending, complete,
--   refunded or charged back, and other (failed, cancelled or expired).
--   Expect no complete, refunded or charged-back add-on payment: nothing has
--   sold add-ons. Pending ones are unpaid checkouts that expire within the
--   hour; they need nothing;
-- - "add-on windows running": add-on periods (private.post_addon_windows) not
--   revoked and not yet ended; expect 0.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.billing_catalogue()',
      'f0c5673fcf9b37b603eac1866472e3d8', '9b88a341204050c9f58dbae7001beb7b'),
    ('internal.get_my_billing()',
      '8c89e002e759c1f5a7c47f92ce465990', 'd5a162ab5bd63b0fed7d6aa0e1a45600'),
    ('internal.get_my_frontend_post_manager()',
      'bf4e28d6a385e6823983ccb93f7315ad', 'ee13e414005ffc5cdf6d4f1ba648ebfe')
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
    from state
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and reviewed <> total and updated <> total
)
select 'summary' as kind,
  'retire paid add-ons: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; add-on versions on sale: ' || (select count(*) from private.addon_versions a where a.retired_at is null)
    || '; add-on payments: pending ' || (select count(*) from private.payments p where p.product_kind = 'addon' and p.status = 'pending')
    || ', complete ' || (select count(*) from private.payments p where p.product_kind = 'addon' and p.status = 'complete')
    || ', refunded or charged back ' || (select count(*) from private.payments p where p.product_kind = 'addon' and p.status in ('refunded', 'chargeback'))
    || ', other ' || (select count(*) from private.payments p where p.product_kind = 'addon' and p.status in ('failed', 'cancelled', 'expired'))
    || '; add-on windows running: ' || (select count(*) from private.post_addon_windows w
         where w.revoked_at is null and w.ends_at > statement_timestamp()) as detail
from state s
union all
select kind, detail from problems;
