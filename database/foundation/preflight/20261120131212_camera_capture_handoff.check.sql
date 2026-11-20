-- Read-only preflight for updates/20261120131212_camera_capture_handoff.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.record_my_selfie_capture and
-- internal.run_retention are the reviewed bodies and the phone-link table and
-- commands are absent (update not applied), or everything is the update's
-- (already applied), and counts:
-- - "selfies said to be uploaded files": selfie receipts whose browser said
--   file_upload (kept as they are; new ones are refused after the update);
-- - after the update, "phone links": rows in private.capture_handoffs.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.record_my_selfie_capture(uuid,text,boolean)',
      '4ad4bbe1cfe3f8276dfd73e113c34f2f', '1db19e6a9ca63abea8bc055dbaaaa228'),
    ('internal.run_retention(integer)',
      '95dda89b3f540a74110a0ca1eba02e66', '1d51acbc8fb435ac6f9b1f12a9020c2b')
  ) v(sig, reviewed, updated)
),
shape as (
  select (to_regclass('private.capture_handoffs') is not null)::integer
    + (to_regprocedure('internal.purge_capture_handoffs(integer)') is not null)::integer
    + (to_regprocedure('api.start_capture_handoff(text,text,text,jsonb)') is not null)::integer
    + (to_regprocedure('api.redeem_capture_handoff(text,text,uuid)') is not null)::integer
    + (to_regprocedure('api.capture_handoff_context(text)') is not null)::integer
    + (to_regprocedure('api.reserve_handoff_verification_upload(text,uuid,text,text,boolean)') is not null)::integer
    as present
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
      and not ((reviewed = total and present = 0) or (updated = total and present = 6))
)
select 'summary' as kind,
  'camera capture handoff: '
    || case when s.updated = s.total and sh.present = 6 then 'already applied'
         when s.reviewed = s.total and sh.present = 0 then 'update not applied'
         else 'unexpected state' end
    || '; selfies said to be uploaded files: ' || (select count(*) from private.frontend_verification_uploads u
         where u.purpose = 'selfie' and u.capture_method = 'file_upload')
    -- The table exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when sh.present = 6 and s.updated = s.total
         then '; phone links: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.capture_handoffs', false, true, '')))[1]::text
         else '' end as detail
from state s, shape sh
union all
select kind, detail from problems;
