-- Read-only preflight for updates/20261126053631_keep_for_periods.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the six functions have their reviewed bodies
-- (update not applied) or the update's (already applied), and counts the rows
-- the next retention sweep would delete under the new periods (expected 0
-- while the London data is younger than a year):
-- - "contact messages": resolved more than 12 months ago;
-- - "admin invitations": revoked, or whose claimant was erased, more than 12
--   months ago;
-- - "change logs": runtime switch and sign-up mode changes over 5 years old;
-- - "appeals and holds": appeals decided more than 2 years ago whose
--   decision is gone, and content holds released more than 2 years ago that
--   no waiting appeal names;
-- - "closed reports": reports closed more than 2 years ago (the existing
--   period), except those an appeal against a warning they gave waits on;
-- - "role changes": staff role change proposals decided or expired more than
--   5 years ago;
-- - "claim events": evidence case claim events over 2 years old;
-- - "slot limits": raised slot limits that ended more than 2 years ago;
-- - "ID return reasons": returns over 12 months old (holds not counted);
-- - "privacy request proofs": minimised requests closed more than 3 years ago.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)),
      'absent') as body
  from (values
    ('internal.retention_tax_year_due(timestamp with time zone)',
      '330c487132c054e1995261d5e92871b2', 'e9e2b8fd093f12e0363d0fadf760ffec'),
    ('internal.retention_privacy_requests(integer)',
      'ae00ab54c00fd3f6f64ac6b8061ba929', 'daec57205cdb25a6d30b767ecec59ffd'),
    ('internal.retention_operations(integer)',
      'c435cece42784f1bcf61a3b47ea32944', 'a76b7c5b983c43c687d0abf47965f6f6'),
    ('internal.retention_staff_records(integer)',
      '63218a3ffaab86d4ead4788f13ed5103', '6e425b22b04938c1e1da5e37f3bda361'),
    ('internal.retention_verification(integer)',
      '6a7db601e6af1cfcc55f697f7d841dd2', '56e4f71f0ad4ecb994e79ea9b0d695b8'),
    ('internal.individual_slot_limit_guard()',
      '556e2de64a5eb7ca998744fa0abb5c84', '9a7d826f695d7e18d815b122d6c5afd2')
  ) v(sig, reviewed, updated)
),
state as (
  select bool_and(body = reviewed) as absent, bool_and(body = updated) as applied from bodies
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
)
select 'summary' as kind,
  'keep-for periods: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; contact messages: '
    || (select count(*) from private.support_tickets t where t.status = 'resolved'
         and coalesce((select max(e.created_at) from private.support_ticket_events e
           where e.ticket_id = t.id and e.status = 'resolved'), t.created_at) < statement_timestamp() - interval '12 months')
    || '; admin invitations: '
    || (select count(*) from private.owner_admin_invitations i
         where i.revoked_at < statement_timestamp() - interval '12 months'
           or exists(select 1 from private.account_erasures e where e.user_id = i.claimed_by
             and e.erased_at < statement_timestamp() - interval '12 months'))
    || '; change logs: '
    || ((select count(*) from private.frontend_feature_flag_events e where e.created_at < statement_timestamp() - interval '5 years')
      + (select count(*) from private.signup_mode_events e where e.changed_at < statement_timestamp() - interval '5 years'))
    || '; appeals and holds: '
    || ((select count(*) from private.frontend_appeals a where a.resolved_at < statement_timestamp() - interval '2 years'
           and not exists(select 1 from private.frontend_appealable_actions x where x.id = a.action_id))
      + (select count(*) from private.frontend_content_holds h where h.released_at < statement_timestamp() - interval '2 years'
           and not exists(select 1 from private.frontend_appeals a where a.action_id = h.id and a.status = 'submitted')))
    || '; closed reports: '
    || (select count(*) from private.reports r where r.status <> 'open'
         and r.resolved_at < statement_timestamp() - interval '2 years'
         and not exists(select 1 from private.frontend_report_action_receipts c
           join private.frontend_appeals a on a.action_id = c.id
           where c.report_id = r.id and a.status = 'submitted'))
    || '; role changes: '
    || (select count(*) from private.frontend_staff_role_changes c
         where coalesce(c.decided_at, c.expires_at) < statement_timestamp() - interval '5 years')
    || '; claim events: '
    || (select count(*) from private.frontend_evidence_claim_events e where e.created_at < statement_timestamp() - interval '2 years')
    || '; slot limits: '
    || (select count(*) from private.individual_slot_limits l
         where coalesce(l.revoked_at, l.ends_at) < statement_timestamp() - interval '2 years')
    || '; ID return reasons: '
    || (select count(*) from private.verification_return_requests r where r.created_at < statement_timestamp() - interval '12 months')
    || '; privacy request proofs: '
    || (select count(*) from private.privacy_requests x where x.minimised_at is not null
         and coalesce(x.completed_at, x.minimised_at) < statement_timestamp() - interval '3 years') as detail
from state s
union all
select kind, detail from problems;
