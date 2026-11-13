-- Read-only preflight for updates/20261113133605_staff_invoice_payments.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (its new functions, the table
-- private.invoice_transfers, its trigger and the capability
-- payments:confirm_transfer are absent, the receipt read is the earlier one,
-- the staff audit view does not list bank transfers and private.payments
-- accepts only Ozow payments) or applied (every body and payment rule is the
-- update's), and counts the recorded bank transfers waiting for confirmation
-- and the payments confirmed from a bank transfer once applied. A problem row
-- is shown when 20261113021223_staff_payment_fixes.sql or the individual slot
-- rules are not present with their reviewed bodies (this update needs them).
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.invoice_transfer_guard()', '2797782f05696a8cbabcd243efb716e6'),
    ('internal.assert_staff_not_referrer(uuid,uuid)', '1e9fa59ac5ab01018789e91e882e4363'),
    ('internal.invoice_customer_by_email(text)', 'd972c0ebbd47f3bd5fbe7cd355ddf446'),
    ('internal.invoice_transfer_dto(private.invoice_transfers,uuid)', '271116a2ef1b920f162c0c6e3dd9d367'),
    ('internal.get_staff_invoice_customer(text)', '6a57d5ad1c9ab0ff8cd97c991afd38b7'),
    ('api.get_staff_invoice_customer(text)', '5d0cac600807f6a77ef8a41ec0180246'),
    ('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)', '6b00db574fbf4056485339f1766460b9'),
    ('api.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)', '2428c38dc7877ae2ca3fb3c4c9ea5b1b'),
    ('internal.lock_invoice_transfer_for_review(uuid,uuid)', 'bf73096cddd3d08eb23f6b0dd87967ee'),
    ('internal.confirm_staff_invoice_payment(uuid)', '216b293e1b4104ee91657556956b2204'),
    ('api.confirm_staff_invoice_payment(uuid)', 'cf439d1781015f8561f5bf7c1f326186'),
    ('internal.decline_staff_invoice_payment(uuid,text)', 'cc8641faee31c5a9a043e4c510d26302'),
    ('api.decline_staff_invoice_payment(uuid,text)', '5074950cec394946e97e5ec183d77d9c'),
    ('internal.get_staff_invoice_transfers()', '37ec35ae8968df035025e3c69234f3be'),
    ('api.get_staff_invoice_transfers()', 'cfc5c52c20818b63133e796f75600c0f'),
    ('internal.get_staff_invoice_payments(uuid[])', '96c9643c1e0128672d6528f0e4f61aaf'),
    ('api.get_staff_invoice_payments(uuid[])', '526991f8c1f78cacddb8558606f31c2c')
  ) v(sig, after)
),
changed as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.get_payment_receipt(uuid)', '1c8ef468ae622086d57af8b8c16fb886', '82b6d1f1a4f8f1b7e1325c71146b453d')
  ) v(sig, before, after)
),
needed as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.assert_staff_payment_actor(uuid,uuid)', 'fe81cc39557206e06346fcf5e9f33bfd'),
    ('internal.payment_delivery_commission(uuid)', '173b97b47147f69d097daba72def56d9'),
    ('internal.payment_partner_commission()', 'e99f071fae090328566a61186843c6e2'),
    ('internal.reverse_payment(uuid,text,text)', '66005adb9e06b17e689dbac47ce93d5a'),
    ('internal.payment_invoice_vat(private.payments)', '8ba4ca6c4ea0207abece5a9fdc57336e'),
    ('internal.payment_invoice_snapshot()', '4b51e17e7650f49c4486ffe86631ff2c'),
    ('internal.payment_quote_guard()', '1042ebb47721d807667a17be53ae2559'),
    ('internal.individual_slots_counted(text,uuid,uuid)', '1444a238736eac1d4de7dc8a53526e9b'),
    ('internal.individual_slot_limit(text)', '90ecd5c02572cc9831468458f3ae0e2d'),
    ('internal.individual_slot_plan(text)', 'c0c1d06dc52122641d02db6b1364be75'),
    ('internal.same_identity(uuid,uuid)', '535e5c87d944edd45bd2b3dce28f98b6'),
    ('api.get_payment_receipt(uuid)', '245869d4f4c606db44bc43c0cea8c4e3')
  ) v(sig, reviewed)
),
rules as (
  select v.name, v.before, v.after,
    (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'private.payments'::regclass
      and c.conname = v.name) as def
  from (values
    ('payments_provider_check', 'CHECK ((provider = ''ozow''::text))',
      'CHECK ((provider = ANY (ARRAY[''ozow''::text, ''invoice''::text])))'),
    ('payments_check1',
      'CHECK ((((status = ''complete''::text) = ((completed_at IS NOT NULL) AND (provider_transaction_id IS NOT NULL))) OR (status = ANY (ARRAY[''refunded''::text, ''chargeback''::text]))))',
      'CHECK ((((status = ''complete''::text) = ((completed_at IS NOT NULL) AND ((provider_transaction_id IS NOT NULL) OR (provider = ''invoice''::text)))) OR (status = ANY (ARRAY[''refunded''::text, ''chargeback''::text]))))'),
    ('payments_invoice_without_ozow', null,
      'CHECK (((provider <> ''invoice''::text) OR ((provider_request_id IS NULL) AND (provider_transaction_id IS NULL) AND (checkout_url IS NULL) AND (checkout_expires_at IS NULL) AND (checkout_claim_token IS NULL) AND (checkout_claim_until IS NULL))))')
  ) v(name, before, after)
),
others as (
  select to_regclass('private.invoice_transfers') is not null as table_present,
    exists (select 1 from pg_trigger t where t.tgname = 'invoice_transfers_guard' and not t.tgisinternal
      and t.tgrelid = to_regclass('private.invoice_transfers')) as trigger_present,
    coalesce(pg_get_viewdef('private.frontend_staff_audit_events'::regclass) like '%invoice_transfers%', false)
      as audit_lists_transfers,
    exists (select 1 from private.staff_capabilities c where c.capability = 'payments:confirm_transfer'
      and c.role = 'admin' and c.requires_recent_mfa) as capability_present
),
state as (
  select
    (select count(*) from added where body is null) + (select count(*) from changed where body = before)
      + (select count(*) from rules where def is not distinct from before)
      + (select (not table_present)::int + (not trigger_present)::int + (not audit_lists_transfers)::int
          + (not capability_present)::int from others) as absent,
    (select count(*) from added where body = after) + (select count(*) from changed where body = after)
      + (select count(*) from rules where def = after)
      + (select table_present::int + trigger_present::int + audit_lists_transfers::int + capability_present::int
          from others) as updated,
    (select count(*) from added) + (select count(*) from changed) + (select count(*) from rules) + 4 as total
),
problems as (
  select 'problem' as kind, sig || ' is not the update''s body (md5 ' || body || '); do not apply the update' as detail
    from added where body is not null and body is distinct from after
  union all
  select 'problem', sig || ' is neither the earlier nor the update''s body (md5 ' || coalesce(body, 'missing')
      || '); do not apply the update'
    from changed where body is distinct from before and body is distinct from after
  union all
  select 'problem', 'private.payments constraint ' || name || ' is neither the earlier nor the update''s rule; do not apply the update'
    from rules where def is distinct from before and def is distinct from after
  union all
  select 'problem', 'payments:confirm_transfer is granted to another role or without a recent second factor; do not apply the update'
    where exists (select 1 from private.staff_capabilities c where c.capability = 'payments:confirm_transfer'
      and (c.role <> 'admin' or not c.requires_recent_mfa))
  union all
  select 'problem', sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing')
      || '); apply 20261113021223_staff_payment_fixes.sql first'
    from needed where body is distinct from reviewed
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from added where body is not null and body is distinct from after)
)
select 'summary' as kind,
  'staff invoice payments: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; bank transfers waiting for confirmation: '
    || case when to_regclass('private.invoice_transfers') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml(
           'select count(*) as n from private.invoice_transfers where status = ''awaiting_confirmation''',
           false, true, '')))[1]::text
       end
    || '; payments confirmed from a bank transfer: '
    || (select count(*) from private.payments where provider = 'invoice') as detail
from state s
union all
select kind, detail from problems;
