-- Read-only preflight for updates/20261114041000_customer_invoice_pay_now.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (its new functions, its three
-- tables and their triggers, the trigger on private.payments, the invoice
-- column, indexes and trigger of private.invoice_transfers and the audit
-- view's invoice rows are absent, and the six functions it replaces have the
-- earlier bodies, the bank transfer guard included) or applied (every body, table, column, index, trigger and
-- the audit view are the update's), and counts the invoices issued, those unpaid,
-- and the "Pay now" payment attempts once applied. A problem row is shown when
-- a function the update builds on is not the reviewed body.
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.customer_invoice_number_guard()', '2e6031880d4018cb9d13913539a754eb'),
    ('internal.customer_invoice_numbers_gapless()', '5c33b3714ea57979ee88f047f5470b1e'),
    ('internal.customer_invoice_guard()', '9ddce773843024268a0e6f8421036995'),
    ('internal.customer_invoice_payment_guard()', '7ad52ae1b3e37ad792d8dca2a275ca96'),
    ('internal.customer_invoice_payment_settled()', 'c04865b075616d005ac7f9886f3e787e'),
    ('internal.customer_invoice_consent()', 'c8625d9b5f050abf31630b09b3a69986'),
    ('internal.customer_invoice_dto(private.customer_invoices,uuid)', '5ce8a88fc44ed9e59a1cfd7dd6214382'),
    ('internal.customer_invoice_number(text)', '24f4bdf5eab06e36bb1961700b89cb23'),
    ('internal.issue_staff_invoice(text,integer,integer,integer,text,uuid)', '2c707542a6b970d11d278df749674b9b'),
    ('api.issue_staff_invoice(text,integer,integer,integer,text,uuid)', 'ece9f1a419332299fbab154220e0e51c'),
    ('internal.customer_invoice_attempt_live(private.payments)', '1fbca3f21e85e48124e88fad05987af7'),
    ('internal.void_staff_invoice(uuid,text)', '83525ee269432148a58b2921bc138d06'),
    ('api.void_staff_invoice(uuid,text)', '653afcae5f4057afb09e618da4a2f57d'),
    ('internal.get_staff_invoices()', '16cf117af866ef67869d54196bb1aecb'),
    ('api.get_staff_invoices()', 'b76ac3d2c2e5fcdbbb12d5a1ec233c26'),
    ('internal.get_staff_invoice(text)', '1b736321dee6be4f8bad4588e1dc2b75'),
    ('api.get_staff_invoice(text)', 'd05ae31e4d2aa228d99f8c88b28d16c0'),
    ('internal.get_my_invoices()', 'ccbff1873558ae50f16406080f8c95a8'),
    ('api.get_my_invoices()', '6892a7e90fee1ae63fe6974908a4641c'),
    ('internal.get_my_invoice(text)', 'c09de82e382314eb3b611440efaf589d'),
    ('api.get_my_invoice(text)', '72559cc96149f8eac3cf52588756259f'),
    ('internal.lock_my_issued_invoice(uuid,text)', 'de83fc6ddf773511eb6d782170c09ede'),
    ('internal.save_my_invoice_billing(text,integer,text,text,text)', 'ec1a645a07efe77b5e1611b6ac9f44b3'),
    ('api.save_my_invoice_billing(text,integer,text,text,text)', '129ad06fc4aff40bb16288ed2447b012'),
    ('internal.start_invoice_payment(text,bigint,boolean)', '1bc2224ded0d1a5ddd03382f1fc2a46f'),
    ('api.start_invoice_payment(text,bigint,boolean)', 'd1321dd29a058e834bcebc392f293e6e'),
    ('internal.customer_invoice_day(timestamp with time zone)', 'af0a1c3cf37d397a9b806e2e67b6124f'),
    ('internal.invoice_transfer_invoice_rule()', '44f62364fd5049bb282bd13360dc7865'),
    ('internal.customer_invoice_settled_elsewhere(uuid)', 'eab13db8976c5bcde805288faec9591c'),
    ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)', '368a7de259a913eddf339bf718abba24'),
    ('api.record_staff_invoice_transfer(text,text,text,boolean,text)', '751d4a9857600ba9a3ee4a61960e5367')
  ) v(sig, after)
),
changed as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.retention_commerce(integer)', '53418aba6b15cf8fa73dc49f25a2f8c3', '20f9abaf7fcccd8b59974226a8ad0f3f'),
    ('internal.frontend_privacy_export_data(uuid)', 'd30c545386536a718e824d1ec56f03ce', 'cea6d5d00f5def4143bde4daa5b84373'),
    ('internal.apply_provider_event(jsonb)', '8a226003da741381225c11dfd1e44308', '8654ccb29310b12224a153f1327325e4'),
    ('internal.activate_staff_paid_payment(uuid,text)', 'd388959dfaee486c2d82b3d5e6f5e709', '355b954c1a0edc055a73485def59cd7c'),
    ('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)', 'fa71c56d4a686ea343f23d551985af9e', 'e02d131400fd0ac64c4d50e616dc4be7'),
    ('internal.confirm_staff_invoice_payment(uuid)', '216b293e1b4104ee91657556956b2204', 'cae341b6ac2373b82529618276d0bfb5'),
    ('internal.invoice_transfer_guard()', '2797782f05696a8cbabcd243efb716e6', '1a73d1dd9054c76a3f52fa415fe7a318')
  ) v(sig, before, after)
),
needed as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.lock_invoice_transfer_for_review(uuid,uuid)', 'bf73096cddd3d08eb23f6b0dd87967ee'),
    ('internal.invoice_transfer_dto(private.invoice_transfers,uuid)', 'b91dbdd96bec847ddb165d6a663cc7cb'),
    ('internal.payment_delivery_commission(uuid)', '173b97b47147f69d097daba72def56d9'),
    ('internal.payment_invoice_vat(private.payments)', '8ba4ca6c4ea0207abece5a9fdc57336e'),
    ('internal.claim_checkout_request(uuid,uuid)', 'd29afcd49f72e712602914d6ecb4d8f5'),
    ('internal.complete_checkout_request(uuid,uuid,uuid,text,text)', 'd392cd27ab1a56d820b917a27118f150'),
    ('internal.price_draft_actor()', '1d70271a4447ba5d1377f3f64a6cf029'),
    ('internal.staff_actor(text)', '269f0871f156f57c029cedcab72f6c3f'),
    ('internal.assert_staff_payment_actor(uuid,uuid)', 'fe81cc39557206e06346fcf5e9f33bfd'),
    ('internal.assert_staff_not_referrer(uuid,uuid)', '1e9fa59ac5ab01018789e91e882e4363'),
    ('internal.invoice_customer_by_email(text)', 'd972c0ebbd47f3bd5fbe7cd355ddf446'),
    ('internal.individual_slots_counted(text,uuid,uuid)', '1444a238736eac1d4de7dc8a53526e9b'),
    ('internal.individual_slot_limit(text)', '90ecd5c02572cc9831468458f3ae0e2d'),
    ('internal.individual_slot_plan(text)', 'c0c1d06dc52122641d02db6b1364be75'),
    ('internal.same_identity(uuid,uuid)', '535e5c87d944edd45bd2b3dce28f98b6'),
    ('internal.lock_evidence_subject(uuid)', '3ef77cf81542607c0ba91f6687255f01'),
    ('internal.plain_text_valid(text,integer,integer,boolean)', 'b3654008b4427d60db398555fef16971'),
    ('internal.profile_public_name(text)', '4e5bc26d138b3abc6b7f33811e380c25'),
    ('internal.record_payment_problem(uuid,text,text,boolean,text)', '73a0ff98c9e3f2003e76349481435cba'),
    ('internal.payment_quote_guard()', '1042ebb47721d807667a17be53ae2559'),
    ('internal.payment_invoice_snapshot()', '4b51e17e7650f49c4486ffe86631ff2c'),
    ('internal.payment_partner_commission()', 'e99f071fae090328566a61186843c6e2'),
    ('internal.retention_tax_year_due(timestamp with time zone)', '330c487132c054e1995261d5e92871b2')
  ) v(sig, reviewed)
),
others as (
  select v.name,
    case v.kind
      when 'table' then to_regclass(v.name) is not null
      when 'column' then exists (select 1 from pg_attribute a where a.attrelid = 'private.invoice_transfers'::regclass
        and a.attname = v.name and not a.attisdropped)
      when 'index' then to_regclass(v.name) is not null
      when 'trigger' then exists (select 1 from pg_trigger t where t.tgname = split_part(v.name, ' on ', 1)
        and not t.tgisinternal and t.tgrelid = to_regclass(split_part(v.name, ' on ', 2)))
      else coalesce(pg_get_viewdef('private.frontend_staff_audit_events'::regclass) like '%customer_invoices%', false)
    end as present
  from (values
    ('table', 'private.customer_invoice_numbers'),
    ('table', 'private.customer_invoices'),
    ('table', 'private.customer_invoice_payments'),
    ('trigger', 'customer_invoice_numbers_guard on private.customer_invoice_numbers'),
    ('trigger', 'customer_invoice_numbers_gapless on private.customer_invoice_numbers'),
    ('trigger', 'customer_invoices_guard on private.customer_invoices'),
    ('trigger', 'customer_invoice_payments_guard on private.customer_invoice_payments'),
    ('trigger', 'payments_customer_invoice_paid on private.payments'),
    ('column', 'customer_invoice_id'),
    ('index', 'private.invoice_transfers_customer_invoice_open_idx'),
    ('index', 'private.invoice_transfers_customer_invoice_idx'),
    ('trigger', 'invoice_transfers_customer_invoice on private.invoice_transfers'),
    ('view', 'audit view lists invoices')
  ) v(kind, name)
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
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from added where body is not null and body is distinct from after)
)
select 'summary' as kind,
  'customer invoices: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; invoices issued: '
    || case when to_regclass('private.customer_invoices') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.customer_invoices', false, true, '')))[1]::text
           || ' (unpaid: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.customer_invoices where status = ''issued''', false, true, '')))[1]::text
           || ')'
       end
    || '; payment attempts: '
    || case when to_regclass('private.customer_invoice_payments') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml(
           'select count(*) as n from private.customer_invoice_payments', false, true, '')))[1]::text
       end as detail
from state s
union all
select kind, detail from problems;
