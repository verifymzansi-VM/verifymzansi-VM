-- Read-only preflight for updates/20261116175757_close_and_erase_account.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (its functions and tables are
-- absent, the 19 functions it replaces have the earlier bodies and the
-- person's column of the kept payment records is still required) or applied
-- (every body, table, index, column, trigger and constraint is the update's),
-- and once applied counts the accounts closed, erased and waiting for their
-- erasure. A problem row is shown when a function the update builds on is not
-- the reviewed body, a function it replaces is neither the earlier reviewed one
-- nor the update's, or the role that owns the functions may not make one of the
-- Auth changes the erasure needs (on each Auth table present).
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.erasure_unlinks(jsonb,jsonb,text[])', '943b4bc3ecd196ed2e6ebef86de94327'),
    ('internal.account_closing_actor()', '170006872f636cdda2a2bbc3e08a0a43'),
    ('internal.account_erasure_hold(uuid)', '5bd01c33cf23f3e6516ceb96c3dc3236'),
    ('internal.account_erasure_state(uuid)', 'ec8d098a16c53ddbd2bf5fd294c92ff8'),
    ('internal.end_account_sessions(uuid)', '9f971fa0e93c70d32f3dd04b0e45420f'),
    ('internal.close_account_now(uuid,text,uuid)', '5d508e7a4d22edd7c09e8698c42a42be'),
    ('internal.remove_account_sign_in(uuid)', 'aaec67adc6e6b35fecfd121fcde635b8'),
    ('internal.remove_erased_auth_user(uuid)', 'cecf40d848c3bf8640f4da165e9f96b6'),
    ('internal.erase_closed_account(uuid,text)', '1dc0781f7497f50fd305dd0903b37ec5'),
    ('internal.close_my_account()', 'facbf3edc7f84a683ce3bf722090c7b6'),
    ('api.close_my_account()', '497894abbfe537492bca61d97b445dd3'),
    ('internal.order_account_erasure(uuid,integer,uuid)', '7737a3b08c8be2a3115385db2dfe416b'),
    ('internal.reject_account_erasure(uuid,uuid)', '72009134a72a73c5dc787c9a39716e54'),
    ('internal.fulfil_account_deletion(uuid,integer)', '07e75332fdfac2c06850bc88248a1382'),
    ('api.fulfil_account_deletion(uuid,integer)', 'ada1b37bc06f9064952039faa438fed3'),
    ('internal.get_account_erasure(uuid)', '19e461c3dc1ee6c95d46a87af1cb37ca'),
    ('api.get_account_erasure(uuid)', '58cd805d7d581748c9c9a0712ffad12c'),
    ('internal.run_account_erasures(integer)', 'a0178c6f0cf9ad67d9772cdba19c26ac'),
    ('internal.outbox_skip_unlinked()', 'cf7beb9259292f061cb2ceb6082eb6c0'),
    ('internal.lock_kept_record_subject(uuid,uuid)', '96acf5f3e2b298480e52fc2067570526'),
    ('internal.retention_privacy_requests(integer)', 'ae00ab54c00fd3f6f64ac6b8061ba929')
  ) v(sig, after)
),
changed as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.payment_quote_guard()', '1042ebb47721d807667a17be53ae2559', 'b5242871b1e3571ce604466a8e514f5f'),
    ('internal.customer_invoice_guard()', '9ddce773843024268a0e6f8421036995', '26e0cb1b12908994f379d2d7d10e91ec'),
    ('internal.invoice_transfer_guard()', '1a73d1dd9054c76a3f52fa415fe7a318', '494dcdb720573571dd36edf97b055332'),
    ('internal.payment_refund_request_guard()', 'c220af13b94b20251d36a33fe643e427', '08e1cff16910b59c8d305a1eae7f7b56'),
    ('internal.partner_commission_guard()', 'ddab4845789fef80739183deeaf75e4d', 'a856ad39d36572068cf94647e3611eb1'),
    ('internal.individual_slot_limit_guard()', '1af83fc4a5bd4555a8b99412f8acc5f1', '556e2de64a5eb7ca998744fa0abb5c84'),
    ('internal.slot_package_guard()', 'be264c746997a4b200c3db5ab0a04fca', 'd249a568a592474a5b94085b0b55457d'),
    ('internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text)', 'e74105108b0992a251828ce6a4fcce54', '989e334ff4fecc3ce76132277e2ea13c'),
    ('internal.run_retention(integer)', 'e3f911342d4f9482b9e91d8f53bdfa1c', '3fc3981961fda5c149c6540e03a5b4c3'),
    ('internal.claim_frontend_privacy_notice()', '4ad5b24618c62302e3e7a8b6fca975d6', 'ab583eeac94d2d46cee6344b5e0d6ef6'),
    ('internal.record_staff_payment_refund(uuid,text,text,text,text)', '49d728545decec524a1a7dd6e09639e1', '2ba50b5b15c6259c1b2c6369d3473e90'),
    ('internal.record_staff_slot_refund(uuid,text,text,text,text)', 'cbea96f3d2df4f3255c565790df97fed', '193a2b3abdbc83b0b16d81d759dc168e'),
    ('internal.record_staff_slot_reversal(uuid,text,text)', '1364f8c78e36281bae5f16a4ba5a466c', 'bea17a08481589403105719076fcdb6d'),
    ('internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb)', '90fd7db662d18b89fdce0e395f92ea0c', 'b47de2156d93ce9ee6a48bcb6d206adc'),
    ('internal.approve_staff_payment_refund(uuid)', 'df4585dd0d0c12f4fbf2e76d9e70a553', '6c7090e7cb1fee5fffd3c3495e76e2ab'),
    ('internal.close_staff_ozow_refund(uuid,text)', '5b7a8a8d3f7bd430e0024fb2088338c3', '9e181ea364774709d7b26cdd5ea7418c'),
    ('internal.record_ozow_refund_send(uuid,jsonb)', '9e3bafab54e36843cc570cf196e9babf', 'f59b72e6c3b8c30bcdf4bec429dd4988'),
    ('internal.apply_ozow_refund_status(jsonb)', '22b002f9363cae60fd6b40635590a3a9', '91430e1a9e30562a65a827e0ecab3a7c'),
    ('internal.void_staff_invoice(uuid,text)', '83525ee269432148a58b2921bc138d06', '21763bcb62e398b6d1b8e8d64ef38ea5')
  ) v(sig, before, after)
),
needed as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.close_account_evidence(uuid)', '0300a2d267a77b797d7316a4cdf43e75'),
    ('internal.lock_evidence_subject(uuid)', '3ef77cf81542607c0ba91f6687255f01'),
    ('internal.staff_actor(text)', '269f0871f156f57c029cedcab72f6c3f'),
    ('internal.media_object_in_use(uuid)', 'c27f5d31c8a98d7b71d51fff22e04766'),
    ('internal.release_sponsorship_entitlement(uuid)', '22d1448929ddae6b57c5bc6f859a5ce2')
  ) v(sig, reviewed)
),
others as (
  select v.kind, v.name, case v.kind
      when 'table' then to_regclass(v.name) is not null
      when 'index' then to_regclass(v.name) is not null
      when 'nullable' then exists (select 1 from pg_attribute a
        where a.attrelid = to_regclass(split_part(v.name, ' ', 1)) and a.attname = split_part(v.name, ' ', 2)
          and not a.attisdropped and not a.attnotnull)
      when 'column' then exists (select 1 from pg_attribute a
        where a.attrelid = to_regclass(split_part(v.name, ' ', 1)) and a.attname = split_part(v.name, ' ', 2)
          and not a.attisdropped)
      when 'trigger' then exists (select 1 from pg_trigger t
        where t.tgrelid = to_regclass(split_part(v.name, ' ', 1)) and t.tgname = split_part(v.name, ' ', 2))
      when 'approval' then exists (select 1 from pg_constraint c
        where c.conrelid = 'private.payment_refund_requests'::regclass and c.conname = v.name
          and pg_get_constraintdef(c.oid) like '%account_id IS NULL%')
      when 'action' then exists (select 1 from pg_constraint c
        where c.conrelid = 'private.privacy_request_events'::regclass and c.conname = v.name
          and pg_get_constraintdef(c.oid) like '%erasure_ordered%')
    end as present
  from (values
    ('column', 'private.privacy_requests minimised_at'),
    ('trigger', 'private.outbox_events outbox_events_unlinked'),
    ('action', 'privacy_request_events_action_check'),
    ('approval', 'payment_refund_requests_approval_rule'),
    ('table', 'private.account_erasures'),
    ('table', 'private.account_erasure_requests'),
    ('index', 'private.account_erasures_due_idx'),
    ('index', 'private.account_erasures_auth_idx'),
    ('index', 'private.account_erasure_requests_user_idx'),
    ('index', 'private.account_erasure_requests_linked_by_idx'),
    ('nullable', 'private.payments owner_id'),
    ('nullable', 'private.customer_invoices account_id'),
    ('nullable', 'private.invoice_transfers account_id'),
    ('nullable', 'private.payment_refund_requests account_id'),
    ('nullable', 'private.entitlements owner_id'),
    ('nullable', 'private.post_activations owner_id'),
    ('nullable', 'private.partner_commissions referred_account_id'),
    ('nullable', 'private.individual_slot_limits account_id'),
    ('nullable', 'private.slot_packages owner_id')
  ) v(kind, name)
),
-- The Auth writes of the erasure, for the role that owns the functions (the
-- owner of internal.close_account_evidence). A hosted Auth table that does not
-- exist is skipped by the update, so only present tables are checked.
privileges as (
  select v.rel, v.priv,
    has_table_privilege((select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner
      where p.oid = to_regprocedure('internal.close_account_evidence(uuid)')), v.rel, v.priv) as granted
  from (values
    ('auth.users', 'SELECT'), ('auth.users', 'UPDATE'), ('auth.users', 'DELETE'),
    ('auth.sessions', 'SELECT'), ('auth.sessions', 'DELETE'),
    ('auth.mfa_factors', 'SELECT'), ('auth.mfa_factors', 'DELETE'),
    ('auth.audit_log_entries', 'SELECT'), ('auth.audit_log_entries', 'DELETE'),
    ('auth.refresh_tokens', 'SELECT'), ('auth.refresh_tokens', 'DELETE'),
    ('auth.identities', 'SELECT'), ('auth.identities', 'DELETE'),
    ('auth.one_time_tokens', 'SELECT'), ('auth.one_time_tokens', 'DELETE'),
    ('auth.flow_state', 'SELECT'), ('auth.flow_state', 'DELETE')
  ) v(rel, priv)
  where to_regclass(v.rel) is not null
),
-- Row level security on an Auth table would hide its rows from an owner that
-- does not bypass it: the erasure would silently change nothing there.
row_security as (
  select distinct v.rel from privileges v
    join pg_class c on c.oid = to_regclass(v.rel)
  where c.relrowsecurity and not coalesce((select r.rolsuper or r.rolbypassrls from pg_proc p
      join pg_roles r on r.oid = p.proowner where p.oid = to_regprocedure('internal.close_account_evidence(uuid)')), false)
),
state as (
  select
    (select count(*) from added where body is null) + (select count(*) from changed where body = before)
      + (select count(*) from others where not present) as absent,
    (select count(*) from added where body = after) + (select count(*) from changed where body = after)
      + (select count(*) from others where present) as updated,
    (select count(*) from added) + (select count(*) from changed) + (select count(*) from others) as total
),
problems as (
  select 'problem' as kind, sig || ' is not the update''s body (md5 ' || body || '); do not apply the update' as detail
    from added where body is not null and body is distinct from after
  union all
  select 'problem', sig || ' is neither the earlier reviewed body nor the update''s (md5 ' || coalesce(body, 'missing')
      || '); do not apply the update'
    from changed where body is distinct from before and body is distinct from after
  union all
  select 'problem', sig || ' is not the reviewed body this update builds on (md5 ' || coalesce(body, 'missing')
      || '); apply the earlier updates first'
    from needed where body is distinct from reviewed
  union all
  select 'problem', 'the function owner lacks ' || priv || ' on ' || rel
      || ' (the erasure removes the sign-in there); do not apply the update'
    from privileges where not granted
  union all
  select 'problem', rel || ' has row level security and the function owner does not bypass it'
      || ' (the erasure would not see its rows); do not apply the update'
    from row_security
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from added where body is not null and body is distinct from after)
)
select 'summary' as kind,
  'close and erase accounts: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || case when to_regclass('private.account_erasures') is null then ''
         else '; accounts closed: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.account_erasures', false, true, '')))[1]::text
           || '; erased: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.account_erasures where erased_at is not null', false, true, '')))[1]::text
           || '; waiting with a hold: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.account_erasures where erased_at is null and blocked_reason is not null',
             false, true, '')))[1]::text
       end as detail
from state s
union all
select kind, detail from problems;
