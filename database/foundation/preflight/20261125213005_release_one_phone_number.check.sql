-- Read-only preflight for updates/20261125213005_release_one_phone_number.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.phone_number_banned,
-- internal.create_verification_phone_challenge and
-- internal.finalize_verification_phone have their reviewed bodies and no
-- release command exists (update not applied), or the update's bodies and its
-- commands (already applied), and counts the numbers running bans block, the
-- release requests waiting and the numbers released. The release columns are
-- read through to_jsonb so the same file runs before and after.
do $$begin
  set transaction read only;
end$$;
with expected(sig, reviewed, updated) as (
  values
    ('internal.phone_number_banned(text)',
      'ddfab60ae9bad5a5b3f8fb3c5200ade3', '07c5a85df974869e998f05d22ba00240'),
    ('internal.create_verification_phone_challenge(uuid,text,text)',
      '635dd87998cdbdb31dcb4fb20e8ef202', 'ba09d4443ff6f61787a12f80bd07e6c8'),
    ('internal.finalize_verification_phone(uuid,uuid,text)',
      '2174d8a4f178fcfe207868e947ddd4af', 'ee0f0b3ff5a0b1f335e673e4f33f72e7')
),
bodies as (
  select e.sig, e.reviewed, e.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure(e.sig)) as body
  from expected e
),
state as (
  select bool_and(body = reviewed) as reviewed, bool_and(body = updated) as updated,
    to_regprocedure('api.propose_phone_number_release(text,text)') is not null
      and to_regprocedure('api.review_phone_number_release(text,timestamptz,boolean)') is not null
      and to_regprocedure('api.get_phone_number_releases()') is not null as commands
  from bodies
),
numbers as (
  select to_jsonb(n) as row, b.retain_until > statement_timestamp() as running
  from private.banned_phone_numbers n
  join private.banned_identities b on b.identity_hmac = n.identity_hmac
),
problems as (
  select 'problem' as kind, sig || ' is neither the reviewed body nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies
    where body is distinct from reviewed and body is distinct from updated
)
select 'summary' as kind,
  'release one phone number: '
    || case when s.updated and s.commands then 'already applied'
         when s.reviewed and not s.commands then 'update not applied'
         else 'unexpected state' end
    || '; numbers blocked: ' || (select count(distinct row ->> 'phone') from numbers
         where running and row ->> 'released_at' is null)
    || '; release requests waiting: ' || (select count(distinct row ->> 'phone') from numbers
         where running and row ->> 'released_at' is null
           and (row ->> 'release_proposed_at')::timestamptz > statement_timestamp() - interval '7 days')
    || '; numbers released: ' || (select count(distinct row ->> 'phone') from numbers
         where row ->> 'released_at' is not null) as detail
from state s
union all
select kind, detail from problems;
