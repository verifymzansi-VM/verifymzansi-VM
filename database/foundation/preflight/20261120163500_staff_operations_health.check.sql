-- Read-only preflight for updates/20261120163500_staff_operations_health.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the seventeen scheduled job commands have their
-- reviewed bodies and the update's table and functions are absent (update not
-- applied), or everything is the update's (already applied). After the
-- update it also counts the jobs with a recorded run (each job records its
-- first run within a minute, 10 minutes or a day of the update, depending on
-- its schedule; see the update's header).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('api.run_slot_renewals(integer)', 'b4e29cfe085196212c3e710c09631de2', 'b78dc0ac9c98fd46da971c17a3f07a43'),
    ('api.run_post_lifecycle(integer)', '3deb53dea49377d22fb4bacf2931ccf8', 'fdc95d2c2e7d7af8411c18e809370cac'),
    ('api.sweep_sponsorships(integer)', '3aa601d7753db12172a8d6783e97c4f5', '4368e3adf7f855a1e677ccb97ad4bb4e'),
    ('api.purge_expired_inbox(integer)', '5b30f6186c05e11a858e8921ae531706', '93aaff6a107125239a173cf5c2c8a2ba'),
    ('api.reconcile_intro_trials(integer)', '7329f1acde5d835684dc1cdfbfb6c59f', 'd0b4dee427e3a6aa0e9be5587d70cae6'),
    ('api.approve_due_commissions(integer)', '840f50cb418a3bd415116ade462b59d0', '44f02582e6b1486ec52dbfd627b77f6f'),
    ('api.expire_waiting_bank_transfers(integer)', '3d191c823e4c8ea01e137dc4cb3b059f', '0b4654bc20b9c08641d06a1780bafec8'),
    ('api.void_ended_package_add_invoices(integer)', 'ff2882aa42979545ada32c671ff1a408', '10c5e610ad372770fce06e5feaf569e3'),
    ('api.claim_supported_notification_outbox(text[],integer)', '70f1b18f7bf830831f1e791eeb054fbc', 'b0dd2ef0c8fa21aa0c07a3b0f530e90e'),
    ('api.claim_payment_alerts(integer)', 'cc0dafa479115c493baf59f491fd79d4', '524e92211a80e57582a04785bd94df5e'),
    ('api.claim_frontend_privacy_notice()', '6d278e3c44af8b191bc8edc5c6dd711b', '05ad93776187bff58e72d43c5f6be3d0'),
    ('api.run_retention(integer)', '149599bb34980837be83753e3b622e01', 'af45cfe715c12bc7e772a7ef3ecf3475'),
    ('api.purge_frontend_form_drafts(integer)', '13c798a36d3441ec17ad532a16b7eb98', 'a41ca813762071f9b0b963d54cf3155a'),
    ('api.claim_evidence_cleanup(integer)', '9837e370cf687084e2e2f492ed6f9053', '9d3d5b7f73ee0100006f71657ff6f79c'),
    ('api.claim_media_cleanup(integer)', '4f8aa155ea7c2a35333d2dce7fe8d10d', '5b146b7b0c1f348bf1713c0f23bfd901'),
    ('api.expire_stale_checkouts(integer)', '463872f511505e0b3ba84e0781814af0', '2181f3dbdaa4dd1d3ab5134d53e96c69'),
    ('api.reconcile_ozow_refunds(jsonb)', 'ea40cc8571dab987fcb5b49d9f27ba53', 'f70c65e80b017e9df3e2f6dc07c6988d'),
    -- Added by the update.
    ('internal.scheduled_job_catalogue()', null, '249bf575fc434934aafe0f0a68ea30dc'),
    ('internal.note_scheduled_job_run(text,anyelement)', null, 'cf02ac7a82119f984b4b5ad5e7a4ee9e'),
    ('internal.get_staff_operations_health()', null, 'bb96b9129c3eb205845d031a37e8b18c'),
    ('api.get_staff_operations_health()', null, '0d522526c382954f585b476ecdb25fac')
  ) v(sig, reviewed, updated)
),
shape as (
  select to_regclass('private.scheduled_job_runs') is not null as has_table
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
      and not ((reviewed = total and not has_table) or (updated = total and has_table))
)
select 'summary' as kind,
  'staff operations health: '
    || case when s.updated = s.total and sh.has_table then 'already applied'
         when s.reviewed = s.total and not sh.has_table then 'update not applied'
         else 'unexpected state' end
    -- The table exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when sh.has_table and s.updated = s.total
         then '; jobs with a recorded run: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.scheduled_job_runs', false, true, '')))[1]::text
           || ' of 17'
         else '' end as detail
from state s, shape sh
union all
select kind, detail from problems;
