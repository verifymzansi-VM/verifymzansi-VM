-- Read-only preflight for updates/20261125213005_release_one_phone_number.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.phone_number_banned has the reviewed body
-- and no release command exists (update not applied), or the update's body
-- and its commands (already applied), and counts the numbers running bans
-- block, the release requests waiting and the numbers released. The release
-- columns are read through to_jsonb so the same file runs before and after.
do $$begin
  set transaction read only;
end$$;
with state as (
  select (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure('internal.phone_number_banned(text)')) as body,
    to_regprocedure('api.propose_phone_number_release(text,text)') is not null
      and to_regprocedure('api.review_phone_number_release(text,boolean)') is not null
      and to_regprocedure('api.get_phone_number_releases()') is not null as commands
),
numbers as (
  select to_jsonb(n) as row, b.retain_until > statement_timestamp() as running
  from private.banned_phone_numbers n
  join private.banned_identities b on b.identity_hmac = n.identity_hmac
),
problems as (
  select 'problem' as kind, 'internal.phone_number_banned(text) is neither the reviewed body nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from state
    where body is distinct from 'ddfab60ae9bad5a5b3f8fb3c5200ade3'
      and body is distinct from '07c5a85df974869e998f05d22ba00240'
)
select 'summary' as kind,
  'release one phone number: '
    || case when s.body = '07c5a85df974869e998f05d22ba00240' and s.commands then 'already applied'
         when s.body = 'ddfab60ae9bad5a5b3f8fb3c5200ade3' and not s.commands then 'update not applied'
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
