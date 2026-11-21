-- Read-only preflight for updates/20261121094003_automatic_identity_checks.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the functions the update relies on are the
-- reviewed bodies, the appeal kinds are the reviewed constraint and the
-- update's tables and commands are absent (update not applied), or everything
-- is the update's (already applied), and counts:
-- - "admins": current admin roles that will hold (or hold) the new capability
--   identity_check:configure;
-- - after the update, "mode" (the setting) and "checks" (rows in
--   private.identity_checks).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.staff_actor(text)', '269f0871f156f57c029cedcab72f6c3f'),
    ('internal.price_draft_actor()', '1d70271a4447ba5d1377f3f64a6cf029'),
    ('internal.append_only_guard()', 'dfac5657b00f4d86a399e04e44d2ea59'),
    ('internal.open_verification_case()', '5da4c2f247cfcb5718366e4315d23fa8'),
    ('internal.complete_evidence_upload(uuid,text,text,integer)', '4ee99e8aba3021a021f9a52d05936083'),
    ('internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer)', 'b8d825cea8120b23aebfc42bb3f3b1ce')
  ) v(sig, reviewed)
),
shape as (
  select (to_regclass('private.identity_checks') is not null)::integer
    + (to_regclass('private.identity_check_settings') is not null)::integer
    + (to_regclass('private.identity_check_mode_events') is not null)::integer
    + (to_regprocedure('api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,integer)') is not null)::integer
    as present,
    (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'private.frontend_appeals'::regclass and c.conname = 'frontend_appeals_kind_check') as kinds
),
state as (
  select sh.present,
    sh.kinds = 'CHECK ((kind = ANY (ARRAY[''suspension''::text, ''ban''::text, ''warning''::text, ''content_hidden''::text])))' as kinds_reviewed,
    sh.kinds = 'CHECK ((kind = ANY (ARRAY[''suspension''::text, ''ban''::text, ''warning''::text, ''content_hidden''::text, ''identity_check''::text])))' as kinds_updated,
    (select count(*) from bodies b where b.body is distinct from b.reviewed) as drifted
  from shape sh
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed
  union all
  select 'problem', 'private.frontend_appeals_kind_check is not the reviewed constraint; do not apply the update'
    from state where not coalesce(kinds_reviewed, false) and not coalesce(kinds_updated, false)
  union all
  select 'problem', 'only part of the update is present'
    from state
    where drifted = 0 and (kinds_reviewed or kinds_updated)
      and not ((present = 0 and kinds_reviewed) or (present = 4 and kinds_updated))
)
select 'summary' as kind,
  'automatic identity checks: '
    || case when s.drifted = 0 and s.present = 4 and s.kinds_updated then 'already applied'
         when s.drifted = 0 and s.present = 0 and s.kinds_reviewed then 'update not applied'
         else 'unexpected state' end
    || '; admins: ' || (select count(*) from private.staff_roles r where r.revoked_at is null and r.role = 'admin')
    -- The tables exist only after the update, so they are read through
    -- query_to_xml, which runs only on this branch.
    || case when s.present = 4 and s.kinds_updated
         then '; mode: ' || (xpath('/row/m/text()', query_to_xml(
             'select mode as m from private.identity_check_settings', false, true, '')))[1]::text
           || '; checks: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.identity_checks', false, true, '')))[1]::text
         else '' end as detail
from state s
union all
select kind, detail from problems;
