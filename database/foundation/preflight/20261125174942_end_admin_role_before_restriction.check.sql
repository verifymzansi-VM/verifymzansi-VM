-- Read-only preflight for updates/20261125174942_end_admin_role_before_restriction.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.propose_decision,
-- internal.propose_frontend_report_restriction and internal.approve_decision
-- have their reviewed bodies (update not applied) or the update's (already
-- applied), and counts the active admins, the active admins who cannot sign in
-- now (for example under a restriction), and the account restriction
-- proposals about an active admin that wait for approval (from the update on,
-- approving one is refused).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure('internal.propose_decision(uuid,integer,text,jsonb)')) as propose_decision,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure('internal.propose_frontend_report_restriction(uuid,integer,text,uuid,text,text,integer,boolean)')) as propose_frontend_report_restriction,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure('internal.approve_decision(uuid)')) as approve_decision
),
admins as (
  select r.user_id from private.staff_roles r where r.role = 'admin' and r.revoked_at is null
),
problems as (
  select 'problem' as kind, 'internal.propose_decision(uuid,integer,text,jsonb) is neither the reviewed body nor the update''s (md5 '
      || coalesce(propose_decision, 'missing') || '); do not apply the update' as detail
    from bodies
    where propose_decision is distinct from '03ca62789e3072be4ad9f2674f623585'
      and propose_decision is distinct from '14c5db672f2151a86ad769d3629df3ce'
  union all
  select 'problem' as kind, 'internal.propose_frontend_report_restriction(uuid,integer,text,uuid,text,text,integer,boolean) is neither the reviewed body nor the update''s (md5 '
      || coalesce(propose_frontend_report_restriction, 'missing') || '); do not apply the update' as detail
    from bodies
    where propose_frontend_report_restriction is distinct from '99896a347df072ba0d1aca2c86839e7b'
      and propose_frontend_report_restriction is distinct from '93ce413d7760cf1e4a4da586cf180e47'
  union all
  select 'problem' as kind, 'internal.approve_decision(uuid) is neither the reviewed body nor the update''s (md5 '
      || coalesce(approve_decision, 'missing') || '); do not apply the update' as detail
    from bodies
    where approve_decision is distinct from 'baf094a3e7e2985bf0962c1a8922c7cb'
      and approve_decision is distinct from '46ede56eac0b30fae87597fa886ef604'
)
select 'summary' as kind,
  'end admin role before restriction: '
    || case
         when b.propose_decision = '14c5db672f2151a86ad769d3629df3ce'
           and b.propose_frontend_report_restriction = '93ce413d7760cf1e4a4da586cf180e47'
           and b.approve_decision = '46ede56eac0b30fae87597fa886ef604' then 'already applied'
         when b.propose_decision = '03ca62789e3072be4ad9f2674f623585'
           and b.propose_frontend_report_restriction = '99896a347df072ba0d1aca2c86839e7b'
           and b.approve_decision = 'baf094a3e7e2985bf0962c1a8922c7cb' then 'update not applied'
         else 'unexpected state' end
    || '; active admins: ' || (select count(*) from admins)
    || '; admins who cannot sign in: ' || (select count(*) from admins a
         where not exists (select 1 from private.current_account_access x where x.id = a.user_id))
    || '; restriction proposals about an admin: ' || (select count(*) from private.decisions d
         join private.evidence_cases c on c.id = d.case_id
         where d.status = 'proposed' and d.action = 'restrict_account'
           and c.subject_id in (select user_id from admins)) as detail
from bodies b
union all
select kind, detail from problems;
