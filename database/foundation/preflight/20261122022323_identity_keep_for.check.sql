-- Read-only preflight for updates/20261122022323_identity_keep_for.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the 11 functions the update replaces have their
-- reviewed bodies and the helper, the trigger and the new constraint are
-- absent (update not applied), or everything is the update's (already
-- applied), and counts:
-- - "mode": the automatic ID check setting;
-- - "checks": rows in private.identity_checks, of which "finished" have left
--   "started" (the update clears their start context);
-- - "accepted identities": current accepted identities, whose selfie and
--   encrypted ID number the update keeps.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.set_identity_check_mode(text,text)', '0747acd14aa377ab9895a3dbe7929052', '7fdea80d198a0df84be848ed1bd934f9'),
    ('internal.start_my_identity_check()', '108e9db93c829bd11fa5914898448816', '22d86444b8cde7fdafd832f8b91da440'),
    ('internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer)', 'fbd21093a62801be26748413932aafcb', '8c27fff47923ec0b410ce8dbd6927fbb'),
    ('internal.decline_automatic_identity_submission(uuid,uuid)', 'abf3f15f72e11a9b6cb9717572929661', '0b5bd2ed7702e07fb42468650b5a7281'),
    ('internal.ask_person_identity_check(uuid,text)', 'd8102d38e3c284bf4050994add9af219', '30979a736f6878a22977b4fde70d1fb6'),
    ('internal.claim_identity_check_deletions(integer)', '40673de778e844021698427b4809c5cf', '141d6c589f1c2269382906d9428539f2'),
    ('internal.identity_check_summary(private.identity_checks)', '2ba0f50d74bc624d4a4e1d8caeca6fa1', '73fdd37368b8112a6e0af490a29e935c'),
    ('internal.return_identity_submission(uuid,integer,text,uuid,text)', 'bc4304d1f5191cae942d30780ce0c29c', '302cb5964e71417ab0d5d44e175b1b83'),
    ('internal.claim_evidence_cleanup(integer)', '7b3da1337260bcd71a5c9f2fd55480a5', 'cbf7f8505087f2807fae496d2d5c6b59'),
    ('internal.retention_verification(integer)', 'fe726b6672545b8b33901361eaf91226', '708479107a014a4504d7d57e60419cf7'),
    ('internal.evidence_artifact_submission_guard()', '2cf882f651413912b4d9cc67d8db01b7', '9bad086a99cfd7626dfc7253048dd5e7'),
    ('internal.identity_record_kept(uuid)', null, 'aa7e632f9d2534b78d6758b5fe1f3213'),
    ('internal.identity_check_clear_start()', null, 'cfc77851e58d5327eaccba09c6712f1e')
  ) v(sig, reviewed, updated)
),
shape as (
  select (exists(select 1 from pg_trigger t where t.tgrelid = 'private.identity_checks'::regclass
        and t.tgname = 'identity_check_clear_start'))::integer
    + (exists(select 1 from pg_constraint c where c.conrelid = 'private.identity_checks'::regclass
        and c.conname = 'identity_checks_start_cleared_check'))::integer as present
),
state as (
  select
    count(*) filter (where b.body is not distinct from b.reviewed) as reviewed,
    count(*) filter (where b.body = b.updated) as updated,
    count(*) as total,
    (select present from shape) as present
  from bodies b
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body or the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state s
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and not ((s.reviewed = s.total and s.present = 0) or (s.updated = s.total and s.present = 2))
)
select 'summary' as kind,
  'identity keep-for: '
    || case when s.updated = s.total and s.present = 2 then 'already applied'
         when s.reviewed = s.total and s.present = 0 then 'update not applied'
         else 'unexpected state' end
    || '; mode: ' || coalesce((select x.mode from private.identity_check_settings x where x.id), 'missing')
    || '; checks: ' || (select count(*) from private.identity_checks)
    || '; finished: ' || (select count(*) from private.identity_checks k where k.status <> 'started')
    || '; accepted identities: ' || (select count(*) from private.accepted_identity_facts f where f.revoked_at is null)
    as detail
from state s
union all
select kind, detail from problems;
