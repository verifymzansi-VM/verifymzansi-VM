-- Read-only preflight for updates/20261117140533_member_notices_in_app.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says whether the five functions the update adds or replaces are
-- the reviewed bodies (the update replaces them) or already the updated ones,
-- and counts "new-kind notices": notices of the 17 kinds the update adds (0
-- before it). Apply the update only once the website release that knows these
-- kinds is live (see updates/README.md).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.list_my_notifications(timestamp with time zone,uuid,integer)', '7defb01cc11b56fcfc1417dd25127653', '7ecfbc9b0bbb788b862f78f6cdfda399'),
    ('internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone)', 'c6961ccad51ed7b788a43a1c5a4fb505', 'e397d8e39f9939146339f5b1b368a51c'),
    ('internal.notify_frontend_business_check()', 'b2b0c8f2ee524951767db095c96f383d', '5efb7f8b5ac8b062492d64397a34b1a4'),
    -- Added by the update: absent before it.
    ('internal.notify_member_of_outbox_event()', null, '5b7257d168070e6be5d8ba1a0893989a'),
    ('internal.notify_post_moderation()', null, '910884e45c0034cb341a553c92276833')
  ) v(sig, reviewed, updated)
),
state as (
  select count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is missing' as detail from bodies where body is null and reviewed is not null
  union all
  select 'problem', sig || ' is not the reviewed body (md5 ' || body || '); do not apply the update'
    from bodies where body is not null and body is distinct from reviewed and body <> updated
  union all
  select 'problem', 'some bodies are updated and others are not' from state where updated > 0 and updated < total
  union all
  select 'problem', 'private.notifications kinds are not the reviewed list; do not apply the update'
    where not ((select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','enquiry_received','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','verification_returned']::text[]
      or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','draft_deletion_warning','enquiry_received','identity_accepted','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','payment_completed','payment_reconciliation_required','payment_reversed','post_approved','post_changes_approved','post_changes_rejected','post_deleted','post_expired','post_expiry_reminder','post_kept','post_rejected','post_sold','slot_renewal_reminder','trial_started','verification_phone_confirmed','verification_returned']::text[])
)
select 'summary' as kind,
  'member notices in app: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied (reviewed bodies; apply only once the website release that knows these kinds is live)'
         else 'unexpected bodies' end
    || '; new-kind notices: ' || (select count(*) from private.notifications where kind in('identity_accepted',
         'verification_phone_confirmed','payment_completed','payment_reversed','payment_reconciliation_required',
         'trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','post_sold',
         'post_kept','slot_renewal_reminder','post_approved','post_rejected','post_changes_approved','post_changes_rejected')) as detail
from state s
union all
select kind, detail from problems;
