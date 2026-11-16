-- Read-only preflight for updates/20261116211438_online_payment_limit.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and starts "online payment limit: update not
-- applied".
--
-- The summary says whether the update is absent (the three functions it
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
    ('internal.start_slot_checkout(uuid,integer,bigint,boolean)', '4ce514eae4c2fb3fd9b0a0ecc40ac498', '0a6cde678881926d76b0f77128e19ffa'),
    ('internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)', '94de32ca80099d59db23aed33c6e7ee2', 'c6a863a4a9d30de454890c11e7d7ca10'),
    ('internal.start_invoice_payment(text,bigint,boolean)', '1bc2224ded0d1a5ddd03382f1fc2a46f', '0768f484f693cabe73b4c959a593ba7e'),
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
