-- Read-only preflight for updates/20261110173012_verification_returned_notice.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says whether the four functions the update replaces are the
-- reviewed bodies (the update replaces them) or already the updated ones, and
-- counts:
-- - "identity cases sent back so far": return requests recorded before the
--   update. Their members are not notified by the update.
-- - "returned notices" and "returned emails not yet sent": what the update
--   has queued since it was applied (0 before it).
-- Apply the update only once the website release that knows the
-- 'verification_returned' kind is live (see updates/README.md).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.return_identity_submission(uuid,integer,text,uuid,text)', '8f14802233e3eabd10580aee3ff923a7', 'bc4304d1f5191cae942d30780ce0c29c'),
    ('internal.claim_supported_notification_outbox(text[],integer)', 'f0a000c6709e523e5aa2ef59af2f1948', '13d3edc000634dfd830ffd1baa846381'),
    ('internal.list_my_notifications(timestamp with time zone,uuid,integer)', '73580f30d3e3e417244d51c67e77e349', '7defb01cc11b56fcfc1417dd25127653'),
    ('internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone)', 'c362f120c59bf8a4fe0b5c56b33abf95', 'c6961ccad51ed7b788a43a1c5a4fb505')
  ) v(sig, reviewed, updated)
),
state as (
  select count(*) filter (where body = reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is missing' as detail from bodies where body is null
  union all
  select 'problem', 'apply 20261110045944_intro_trial_at_first_approval.sql first'
    from bodies where sig like 'internal.claim_supported_notification_outbox%' and body = '039b1e461ee382e1e2ae7afc31f9d304'
  union all
  select 'problem', sig || ' is not the reviewed body (md5 ' || body || '); do not apply the update'
    from bodies where body not in (reviewed, updated) and body <> '039b1e461ee382e1e2ae7afc31f9d304'
  union all
  select 'problem', 'some bodies are updated and others are not' from state where updated > 0 and updated < total
  union all
  select 'problem', 'private.notifications kinds are not the reviewed list; do not apply the update'
    where not ((select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','enquiry_received','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed']::text[]
      or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','enquiry_received','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','verification_returned']::text[])
  union all
  select 'problem', 'private.outbox_events kinds are not the reviewed list; do not apply the update'
    where not ((select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.outbox_events'::regclass and c.conname='outbox_events_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','draft_deletion_warning','enquiry_received','identity_accepted','payment_completed','payment_reconciliation_required','payment_reversed','post_deleted','post_expired','post_expiry_reminder','post_kept','post_sold','trial_started','verification_phone_confirmed']::text[]
      or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.outbox_events'::regclass and c.conname='outbox_events_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','draft_deletion_warning','enquiry_received','identity_accepted','payment_completed','payment_reconciliation_required','payment_reversed','post_deleted','post_expired','post_expiry_reminder','post_kept','post_sold','trial_started','verification_phone_confirmed','verification_returned']::text[])
)
select 'summary' as kind,
  'verification returned notice: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'reviewed bodies, update not applied (apply only once the website release that knows this kind is live)'
         else 'unexpected bodies' end
    || '; identity cases sent back so far: ' || (select count(*) from private.verification_return_requests)
    || '; returned notices: ' || (select count(*) from private.notifications where kind = 'verification_returned')
    || '; returned emails not yet sent: '
    || (select count(*) from private.outbox_events where kind = 'verification_returned' and processed_at is null) as detail
from state s
union all
select kind, detail from problems;
