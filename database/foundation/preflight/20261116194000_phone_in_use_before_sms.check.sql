-- Read-only preflight for updates/20261116194000_phone_in_use_before_sms.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.create_verification_phone_challenge is the
-- reviewed body (update not applied) or the update's (already applied), and
-- counts:
-- - "active phone proofs": verified numbers in use, one per account;
-- - "open codes for a number in use": unexpired, unverified challenges for a
--   number another account holds. Each would be refused at its last step; the
--   update does not change them, and they expire within five minutes.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.create_verification_phone_challenge(uuid,text,text)',
      '3b433478c2e7b15b7889ba5d16e026ad', '6bd315ea00157c1caf6655ed17a079be')
  ) v(sig, reviewed, updated)
),
problems as (
  select 'problem' as kind,
    sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
  from bodies where body is distinct from reviewed and body is distinct from updated
)
select 'summary' as kind,
  'phone in use before sms: '
    || case when b.body = b.updated then 'already applied'
         when b.body = b.reviewed then 'update not applied'
         else 'unexpected state' end
    || '; active phone proofs: '
    || (select count(*) from private.verification_phone_proofs f where f.revoked_at is null)
    || '; open codes for a number in use: '
    || (select count(*) from private.verification_phone_challenges c
        where c.verified_at is null and c.expires_at > clock_timestamp()
          and exists (select 1 from private.verification_phone_proofs f
            where f.phone = c.phone and f.revoked_at is null and f.owner_id <> c.owner_id)) as detail
from bodies b
union all
select kind, detail from problems;
