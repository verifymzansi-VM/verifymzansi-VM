-- Read-only preflight for updates/20261117064820_ban_blocks_phone_numbers.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the two phone functions are the reviewed bodies and
-- the update's helper, trigger function, trigger and table are absent (update
-- not applied), or everything is the update's (already applied), and counts:
-- - "running bans": identity bans whose 5 years have not passed;
-- - "numbers to block" (before) / "numbers blocked" (after): the phone numbers
--   those bans block, by the update's rule (every number the banned person's
--   accounts verified that is still on record, except one another person holds
--   as an active proof). After the update the two must be equal.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.create_verification_phone_challenge(uuid,text,text)',
      '6bd315ea00157c1caf6655ed17a079be', '3661274c4f3c00f87490dd4be0809820'),
    ('internal.finalize_verification_phone(uuid,uuid,text)',
      'b91370e1e74f3713b73dff260eb8d5b0', '2174d8a4f178fcfe207868e947ddd4af'),
    ('internal.phone_number_banned(text)', null, 'ddfab60ae9bad5a5b3f8fb3c5200ade3'),
    ('internal.ban_identity_phone_numbers()', null, '919b5bae6359413e38cb208a98ff1cce')
  ) v(sig, reviewed, updated)
),
shape as (
  select to_regclass('private.banned_phone_numbers') is not null as has_table,
    exists (select 1 from pg_trigger t where t.tgname = 'ban_identity_phone_numbers'
      and t.tgrelid = 'private.banned_identities'::regclass and not t.tgisinternal) as has_trigger
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
    from state, shape
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and not ((reviewed = total and not has_table and not has_trigger)
        or (updated = total and has_table and has_trigger))
),
running as (
  select b.identity_hmac from private.banned_identities b where b.retain_until > clock_timestamp()
),
to_block as (
  select distinct r.identity_hmac, p.phone from running r
    join private.accepted_identity_facts f on f.identity_hmac = r.identity_hmac
    join private.verification_phone_proofs p on p.owner_id = f.owner_id
  where not exists (select 1 from private.verification_phone_proofs o
    where o.phone = p.phone and o.revoked_at is null
      and o.owner_id not in (select f2.owner_id from private.accepted_identity_facts f2 where f2.identity_hmac = r.identity_hmac))
)
select 'summary' as kind,
  'ban blocks phone numbers: '
    || case when s.updated = s.total and sh.has_table and sh.has_trigger then 'already applied'
         when s.reviewed = s.total and not sh.has_table and not sh.has_trigger then 'update not applied'
         else 'unexpected state' end
    || '; running bans: ' || (select count(*) from running)
    -- The table exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when sh.has_table
         then '; numbers blocked: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.banned_identities b join private.banned_phone_numbers p'
             || ' on p.identity_hmac = b.identity_hmac where b.retain_until > clock_timestamp()',
             false, true, '')))[1]::text
           || '; numbers to block: ' || (select count(*) from to_block)
         else '; numbers to block: ' || (select count(*) from to_block) end as detail
from state s, shape sh
union all
select kind, detail from problems;
