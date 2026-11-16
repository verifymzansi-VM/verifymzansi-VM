-- Read-only preflight for updates/20261116211438_online_payment_limit.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and starts "online payment limit: update not
-- applied".
--
-- The summary says whether the update is absent (the four functions it
-- replaces have the earlier bodies and its new functions are absent) or
-- applied (all of them are the update's), the current posting terms, whether
-- posting-v5 is published, and how many payments still pending at Ozow and
-- unpaid invoices are above R1,300 (they cannot be paid online once the
-- update is applied: such an invoice is paid by bank transfer). A problem row
-- is shown when a function is neither body, or posting-v5 is published with
-- another document.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.start_slot_checkout(uuid,integer,bigint,boolean)', 'cae84c17b05a49fc3937064eaaff38f2', 'c8035d1400d4786ded224cbfda9b0864'),
    ('internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)', 'e014633dd37ebb3fa212fc2944dd7ed6', '4c9ceef45be61e47ec685d82e8392c96'),
    ('internal.start_invoice_payment(text,bigint,boolean)', '157a3a3a51c3abfdef565e37a2af3785', '2269112508c2af33e80fccf331f7479c'),
    ('internal.start_package_checkout(uuid,integer,bigint,boolean)', 'feb6e6f31e0bc1f6a1de41e8c927acb8', '947486cd48be84b7a45714ec51d1bae4'),
    ('internal.online_payment_max_cents()', null, '60f453372263eb6dd30aad3239b10852'),
    ('internal.get_payment_limits()', null, 'd2d402b04c9f48d86adaaa6de7b93c8e'),
    ('api.get_payment_limits()', null, '686d9a97358602b6ecd51648ef88133b')
  ) v(sig, before, after)
),
state as (
  select
    bool_and(body is not distinct from before) as absent,
    bool_and(body is not distinct from after) as applied
  from bodies
),
v5 as (
  select (select v.document_hash from private.posting_terms_versions v where v.version = 'posting-v5') as hash
),
summary as (
  select 'summary' as kind,
    'online payment limit: '
      || case when s.absent then 'update not applied (apply before the website release that uses it is deployed)'
              when s.applied then 'already applied' else 'partly applied or changed (see problems)' end
      || '; current posting terms: ' || coalesce((select c.version from private.posting_terms_current c where c.singleton), 'missing')
      || '; posting-v5 ' || case when v5.hash is null then 'not published'
              when v5.hash = 'xXIllN5MmRH6TZR8Cdh3DqqmZI9Nwomh04vExnO5K4Y' then 'published' else 'published with another document' end
      || '; payments pending at Ozow above R1,300: ' || (select count(*) from private.payments p
              where p.status = 'pending' and p.checkout_url is not null and p.amount_cents > 130000)
      || '; unpaid invoices above R1,300: ' || (select count(*) from private.customer_invoices i
              where i.status = 'issued' and i.total_cents > 130000) as detail
  from state s, v5
),
problems as (
  select 'problem' as kind, b.sig || ' is neither the earlier body nor the update''s (' || coalesce(b.body, 'absent') || ')' as detail
  from bodies b, state s
  where not s.absent and not s.applied and b.body is distinct from b.before and b.body is distinct from b.after
  union all
  select 'problem', 'posting-v5 is published with a different document' from v5
  where v5.hash is not null and v5.hash <> 'xXIllN5MmRH6TZR8Cdh3DqqmZI9Nwomh04vExnO5K4Y'
)
select kind, detail from summary
union all
select kind, detail from problems;
