-- Read-only preflight for updates/20261111184619_selfie_capture_method.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says whether the upload completion is the reviewed
-- seven-argument body (the update replaces it) or already the update's
-- nine-argument one with the staff read, and counts:
-- - "selfie receipts": completed selfie upload receipts so far;
-- - "with a capture method": how many of them carry the browser's answer
--   (0 before the update; earlier receipts stay empty).
-- Apply the update before the website release that sends these values is
-- deployed (see updates/README.md).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.expected,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer)', '737041e48e8be2f17d7eb0e4a3dd2ba3'),
    ('api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer)', '4bd0236e450555b0340a319891244e87'),
    ('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)', 'edd196d8ef77532f8f07fd4a02ca9c4f'),
    ('api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)', '4a17f8bbad56ecd3191a72d45287511e'),
    ('internal.get_frontend_staff_selfie_capture(uuid,text,uuid)', '409db62cee2182fa6151df48406dc394'),
    ('api.get_frontend_staff_selfie_capture(uuid,text,uuid)', '774a7b78891fffc1758eb1ce34728c17')
  ) v(sig, expected)
),
state as (
  select
    count(*) filter (where sig like '%,integer)' and body is not null) as old_present,
    count(*) filter (where sig like '%,integer)' and body = expected) as old_reviewed,
    count(*) filter (where sig not like '%,integer)' and body is not null) as new_present,
    count(*) filter (where sig not like '%,integer)' and body = expected) as new_updated,
    (select count(*) from pg_attribute a where a.attrelid = 'private.frontend_verification_uploads'::regclass
      and a.attname in ('capture_method', 'browser_liveness_passed') and not a.attisdropped) as columns
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body (md5 ' || body || '); do not apply the update' as detail
    from bodies where body is not null and body <> expected
  union all
  select 'problem', 'both the old and the new upload completion exist' from state where old_present > 0 and new_present > 0
  union all
  select 'problem', 'the upload completion is missing' from state where old_present = 0 and new_present = 0
  union all
  select 'problem', 'only part of the update is present' from state
    where old_present = 0 and new_present > 0 and (new_present < 4 or columns < 2)
  union all
  select 'problem', 'the capture columns exist before the update' from state where old_present > 0 and (columns > 0 or new_present > 0)
)
select 'summary' as kind,
  'selfie capture method: '
    || case when s.new_updated = 4 and s.columns = 2 and s.old_present = 0 then 'already applied'
         when s.old_reviewed = 2 and s.new_present = 0 and s.columns = 0 then 'reviewed bodies, update not applied (apply before the website release that sends these values is deployed)'
         else 'unexpected state' end
    || '; selfie receipts: '
    || (select count(*) from private.frontend_verification_uploads where purpose = 'selfie' and completed_at is not null)
    || '; with a capture method: '
    || case when s.columns = 2 then (select count(*) from private.frontend_verification_uploads u
         where (to_jsonb(u) ->> 'capture_method') is not null)::text else '0' end as detail
from state s
union all
select kind, detail from problems;
