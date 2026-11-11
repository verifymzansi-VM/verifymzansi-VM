-- Read-only preflight for updates/20261111184619_selfie_capture_method.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says whether the receipt scrub is the reviewed body and the
-- update's two commands and two columns are absent (the update adds them), or
-- everything is already the update's, and counts:
-- - "selfie receipts": completed selfie upload receipts so far;
-- - "with a capture method": how many receipts carry the browser's answer
--   (0 before the update; earlier receipts stay empty).
-- Apply the update before the website release that uses it is deployed (see
-- updates/README.md).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.scrub_frontend_verification_receipt()', 'a2bcb31f73b232d41b605c4b8b51b155', '8e9a4a32bfe4f789bb94d74edf6d4f76'),
    ('internal.record_my_selfie_capture(uuid,text,boolean)', null, '4ad4bbe1cfe3f8276dfd73e113c34f2f'),
    ('api.record_my_selfie_capture(uuid,text,boolean)', null, '5a227ba0cea8a58d5d0e55a35f2d6afb'),
    ('internal.get_frontend_staff_selfie_capture(uuid,text,uuid)', null, '409db62cee2182fa6151df48406dc394'),
    ('api.get_frontend_staff_selfie_capture(uuid,text,uuid)', null, '774a7b78891fffc1758eb1ce34728c17')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total,
    (select count(*) from pg_attribute a where a.attrelid = 'private.frontend_verification_uploads'::regclass
      and a.attname in ('capture_method', 'browser_liveness_passed') and not a.attisdropped) as columns
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state where not (reviewed = total and columns = 0) and not (updated = total and columns = 2)
      and not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
)
select 'summary' as kind,
  'selfie capture method: '
    || case when s.updated = s.total and s.columns = 2 then 'already applied'
         when s.reviewed = s.total and s.columns = 0 then 'reviewed bodies, update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; selfie receipts: '
    || (select count(*) from private.frontend_verification_uploads where purpose = 'selfie' and completed_at is not null)
    || '; with a capture method: '
    || (select count(*) from private.frontend_verification_uploads u where (to_jsonb(u) ->> 'capture_method') is not null) as detail
from state s
union all
select kind, detail from problems;
