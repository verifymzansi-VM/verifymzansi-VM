-- Read-only preflight for updates/20261118072601_staff_data_minimisation.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says whether the 15 functions the update replaces are the
-- reviewed bodies (the update replaces them) or already the updated ones, and
-- counts privacy requests started or completed before the update (they need a
-- second staff member's approval before they can be exported or completed)
-- and support tickets the inbox no longer lists (resolved, received more than
-- 12 months ago).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.get_frontend_business_review_queue(text)', 'afa2682424091858300bd050cd6d5703', '02eed4ae21b86c982feda572871add03'),
    ('internal.get_frontend_seen_queue(text)', '81c4f1cdd36754f5faf365abab0cb136', '1739b49ce16a79538ed569b6668b5910'),
    ('internal.get_frontend_seen_case(uuid)', '2c8bbc78d69a047bb8dbc5b645c82d03', '1275da13ade5358710b03902b00e7248'),
    ('internal.get_frontend_cipc_case(uuid)', '53c819e3ac10ef4cdb5727c2e2222b9c', 'ed026d48191cac201053305cde485957'),
    ('internal.staff_verification_queue(integer)', '9ec9ce3e17e200f53b4fdeb0da922901', '8ecd9727c64d6c8dee4e4af2e8da4649'),
    ('internal.get_frontend_staff_verification_queue(integer,uuid[])', '6443fe7d593913d62aef9b868453fe18', '9c87b1e5234ba46a5678cf6bb0b4d3c1'),
    ('internal.get_frontend_privacy_queue(text,integer)', 'ffc1120344cf8eabd09d740521ced350', '73c23d0393783b2a3760bdca0060923b'),
    ('internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text)', '989e334ff4fecc3ce76132277e2ea13c', 'af1e804567d16989fe47019e6fcd33f7'),
    ('internal.export_frontend_privacy_request(uuid,integer)', 'e055b06c73169fd22e15fef574c0497b', '367f25173e66bb4fcf3d877c0fddff15'),
    ('internal.get_frontend_support_inbox(integer,uuid)', '607e36e4c31fd96147b4b8d1d5155095', 'dd1dd2e21be1f6accde9652e10f7682b'),
    ('internal.get_frontend_organisation_dashboard(text)', '8823a5e28eac986cbc4df251b0c47183', '50c7ba8869e2fc3f8cc5b68bb0e2f4ed'),
    ('api.get_staff_invoices()', 'b76ac3d2c2e5fcdbbb12d5a1ec233c26', '683c792ecb73a3c19eac080e23971cae'),
    ('api.get_staff_invoice(text)', 'd05ae31e4d2aa228d99f8c88b28d16c0', 'b048c33607a4a97a1027a74471aef453'),
    ('api.get_staff_invoice_transfers()', 'cfc5c52c20818b63133e796f75600c0f', '6fb783a08c583150f0f2a2d34d3e7245'),
    ('api.get_staff_invoice_payments(uuid[])', '526991f8c1f78cacddb8558606f31c2c', 'b6e790c043538085d440789f3b7b22b8'),
    -- Added by the update: absent before it.
    ('internal.staff_actor_recent(text)', null, 'e44bafe2778bca781b2a7ffcfe7f3f5f'),
    ('internal.reveal_organisation_applicant_contact(uuid)', null, '173148aa3c716e3e43645e4d11edbdd3'),
    ('api.reveal_organisation_applicant_contact(uuid)', null, 'f6b2088f77d110d2b5be6683f8d6cb9a')
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
  select 'problem', 'private.notifications notifications_kind_check is not the reviewed list; do not apply the update'
    where (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','content_restored','draft_deletion_warning','enquiry_received','identity_accepted','invoice_issued','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','payment_completed','payment_reconciliation_required','payment_reversed','post_approved','post_changes_approved','post_changes_rejected','post_deleted','post_expired','post_kept','post_rejected','post_sold','slot_renewal_reminder','trial_started','verification_phone_confirmed','verification_returned']::text[]
      and (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','content_restored','draft_deletion_warning','enquiry_received','identity_accepted','invoice_issued','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','payment_completed','payment_reconciliation_required','payment_reversed','post_approved','post_changes_approved','post_changes_rejected','post_deleted','post_expired','post_kept','post_rejected','post_sold','privacy_export_made','privacy_request_approved','slot_renewal_reminder','trial_started','verification_phone_confirmed','verification_returned']::text[]
  union all
  select 'problem', 'private.privacy_notice_jobs privacy_notice_jobs_kind_check is not the reviewed list; do not apply the update'
    where (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.privacy_notice_jobs'::regclass and c.conname='privacy_notice_jobs_kind_check') is distinct from array['completed','extended','rejected','submitted']::text[]
      and (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.privacy_notice_jobs'::regclass and c.conname='privacy_notice_jobs_kind_check') is distinct from array['approved','completed','exported','extended','rejected','submitted']::text[]
  union all
  select 'problem', 'private.privacy_request_events privacy_request_events_action_check is not the reviewed list; do not apply the update'
    where (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.privacy_request_events'::regclass and c.conname='privacy_request_events_action_check') is distinct from array['assigned','completed','erasure_ordered','exported','extended','identity_verified','recorded','rejected','started','submitted','unassigned']::text[]
      and (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.privacy_request_events'::regclass and c.conname='privacy_request_events_action_check') is distinct from array['approved','assigned','completed','erasure_ordered','exported','extended','identity_verified','recorded','rejected','started','submitted','unassigned']::text[]
)
select 'summary' as kind,
  'staff data minimisation: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected bodies' end
    || '; privacy requests in progress or completed without a second approval: '
    || (select count(*) from private.privacy_requests r where r.status in ('in_progress', 'completed')
         and r.minimised_at is null and not coalesce((to_jsonb(r) ->> 'approved_at') is not null, false))
    || '; resolved support tickets older than 12 months: '
    || (select count(*) from private.support_tickets t where t.status = 'resolved'
         and t.created_at < clock_timestamp() - interval '12 months') as detail
from state s
union all
select kind, detail from problems;
