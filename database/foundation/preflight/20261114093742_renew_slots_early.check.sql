-- Read-only preflight for updates/20261114093742_renew_slots_early.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (its new functions, columns,
-- constraints, indexes and trigger are absent, the outbox does not know the
-- reminder kind, the thirteen functions it replaces have the earlier bodies
-- and the two post funding views fund a post by its own period) or applied
-- (every body, column, constraint, index, trigger and view is the update's),
-- and counts the renewal payment lines, the renewals issued and
-- the reminders queued once applied. A problem row is shown when a function
-- the update builds on is not the reviewed body.
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.individual_slot_owners(text,uuid)', '49c59acc8f02fcb09e757c0584b7de51'),
    ('internal.slot_renewal_window()', 'c238f2c972a2f767c6a70d939d552000'),
    ('internal.slot_chain_last_end(uuid)', 'b1751aee92ddb5d65ed0c95a0bc1b8ea'),
    ('internal.slot_chain_held(uuid)', '23b8b9c552d561b4f2d818e9d5056f61'),
    ('internal.slot_chain_end(uuid)', 'de3528681a1ad52128c6db296e413d12'),
    ('internal.slot_renewal_due(uuid,uuid)', 'f0eb3360c8456cc4b191c315c61c482e'),
    ('internal.individual_slots_extended(text,uuid,uuid,uuid[],timestamp with time zone)', 'fa0c223b351aa2fb07c4d1d1c42a9f24'),
    ('internal.slot_lines_adding(uuid)', '74fe04e6cff80dece687c24e05c18fb7'),
    ('internal.slot_lines_renewing(uuid)', '9ce02eccc93128dff9142cb06db0efe6'),
    ('internal.individual_renewals_allowed(text,uuid,uuid,uuid[])', '0012cbcef8b31da4ed93ee267ca13afd'),
    ('internal.slot_grant_usable(uuid,text,timestamp with time zone,timestamp with time zone)', 'b43abb8cb82c15c1a3f240680d3710ac'),
    ('internal.refresh_slot_chain_documents(uuid)', '8654d4f1d0886ad9e877835077a2ad3d'),
    ('internal.slot_grant_revoked()', '00f9bfbdb6f79cc4496f5747b85cdd17'),
    ('internal.issue_slot_line_entitlements(uuid)', '85ae00308b9abb35c6c13bc67821d39d'),
    ('internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)', '94de32ca80099d59db23aed33c6e7ee2'),
    ('api.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)', 'ee9fe432c0390ba2fecdcebff294e775'),
    ('internal.run_slot_renewals(integer)', 'dc2fa45bd9d0502e6f3dafbfd75984d4'),
    ('api.run_slot_renewals(integer)', 'b4e29cfe085196212c3e710c09631de2'),
    ('internal.get_my_slots_v2()', 'ccd8613df13112af02b3d062cc0ea486'),
    ('api.get_my_slots_v2()', '94a9406f69aba4f4abdf419809498258')
  ) v(sig, after)
),
changed as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.individual_slots_counted(text,uuid,uuid)', '1444a238736eac1d4de7dc8a53526e9b', '4213e64e4b2fb9f8062fe02277a28e69'),
    ('internal.start_slot_checkout(uuid,integer,bigint,boolean)', 'dcbb5be85829b017a483c21b91c95602', '4ce514eae4c2fb3fd9b0a0ecc40ac498'),
    ('internal.apply_provider_event(jsonb)', '8654ccb29310b12224a153f1327325e4', '19d5c2eb7e1a75210bc2b77d2cbb961b'),
    ('internal.activate_staff_paid_payment(uuid,text)', '355b954c1a0edc055a73485def59cd7c', '03c8a3314cd99f02fb465a391ca2942f'),
    ('internal.activate_post(uuid)', 'd9dd75c96dd1cce5b490eaafffe308be', 'bc99d728b6a6e4465b87b0fd607aeb08'),
    ('internal.post_funding(uuid)', '48204868fb2cd5b34cd44acbab243a6f', '16c30a8438ae9d43796f5f78f4144ad0'),
    ('internal.claim_supported_notification_outbox(text[],integer)', '13d3edc000634dfd830ffd1baa846381', 'c7206aab3ac04b1f9d9b6ce2dc47bd0f'),
    ('internal.entitlement_for_post_eligible(uuid,uuid,uuid)', 'ff74c8cfdd93037f14e29f53ac0896ff', 'd3861dfcebe2d7e1d6955a0c549b2db3'),
    ('internal.run_post_lifecycle(integer)', 'e902328043d024a4ba16e38eeabb1b73', 'cb178dd0e47f84cbb277a87abd31b140'),
    ('internal.release_frontend_content_hold(uuid,integer,text)', '5c7eaa1a42528d6467b1eb06fe992f4d', 'c975e7b75ad113c28018d36477c953f7'),
    ('internal.set_post_media(uuid,integer,jsonb)', '3ff7aba47039b8f074318e796718f85d', 'cd3c1062f03370a6a9346ed935eff0fc'),
    ('internal.frontend_privacy_export_data(uuid)', 'cea6d5d00f5def4143bde4daa5b84373', '03c73dba3ba38c4866186a8b84b4a521'),
    ('internal.retention_commerce(integer)', '20f9abaf7fcccd8b59974226a8ad0f3f', '06d7529db4898b7bb3b158d38a1d5929')
  ) v(sig, before, after)
),
needed as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.price_draft_actor()', '1d70271a4447ba5d1377f3f64a6cf029'),
    ('internal.lock_evidence_subject(uuid)', '3ef77cf81542607c0ba91f6687255f01'),
    ('internal.individual_slot_identity(uuid)', '4e4552c83cb629e96f1300060eeff16b'),
    ('internal.individual_slot_limit(text)', '90ecd5c02572cc9831468458f3ae0e2d'),
    ('internal.individual_slot_plan(text)', 'c0c1d06dc52122641d02db6b1364be75'),
    ('internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone)', '0db72b1ee054a2d8dd1b946d73c58e41'),
    ('internal.customer_invoice_settled_elsewhere(uuid)', 'eab13db8976c5bcde805288faec9591c'),
    ('internal.addon_purchase_entitlement(uuid,uuid,text)', '2cd60895de8dad14dfe1d1f26ae83543'),
    ('internal.payment_invoice_vat(private.payments)', '8ba4ca6c4ea0207abece5a9fdc57336e'),
    ('internal.payment_delivery_commission(uuid)', '173b97b47147f69d097daba72def56d9'),
    ('internal.staff_actor(text)', '269f0871f156f57c029cedcab72f6c3f'),
    ('internal.assert_staff_payment_actor(uuid,uuid)', 'fe81cc39557206e06346fcf5e9f33bfd'),
    ('internal.plain_text_valid(text,integer,integer,boolean)', 'b3654008b4427d60db398555fef16971'),
    ('internal.retention_tax_year_due(timestamp with time zone)', '330c487132c054e1995261d5e92871b2'),
    ('internal.reverse_payment_line(uuid,text,text,uuid)', '3f95168e1faacac2ca6f1431962c182c'),
    ('internal.reverse_payment(uuid,text,text)', '66005adb9e06b17e689dbac47ce93d5a'),
    ('internal.lock_verification_subject(uuid)', '7b86872a4f8c8495ab393817fe360853'),
    ('internal.retention_reason(text)', 'e452f846d3d2bcff13706c6e315bb53b'),
    ('internal.write_post_projection(uuid)', 'a2cbe4d6ec0700eadd96321ad9d8dca6')
  ) v(sig, reviewed)
),
others as (
  select v.name,
    case v.kind
      when 'column' then exists (select 1 from pg_attribute a where a.attrelid = to_regclass(split_part(v.name, ' ', 1))
        and a.attname = split_part(v.name, ' ', 2) and not a.attisdropped)
      when 'constraint' then exists (select 1 from pg_constraint c where c.conname = split_part(v.name, ' on ', 1)
        and c.conrelid = to_regclass(split_part(v.name, ' on ', 2)))
      when 'index' then to_regclass(v.name) is not null
      when 'view' then coalesce(pg_get_viewdef(to_regclass(v.name)) like '%slot_grant_usable(%', false)
      when 'trigger' then exists (select 1 from pg_trigger t where t.tgname = split_part(v.name, ' on ', 1)
        and not t.tgisinternal and t.tgrelid = to_regclass(split_part(v.name, ' on ', 2)))
      else coalesce((select pg_get_constraintdef(c.oid) like '%slot_renewal_reminder%' from pg_constraint c
        where c.conname = 'outbox_events_kind_check' and c.conrelid = 'private.outbox_events'::regclass), false)
    end as present
  from (values
    ('column', 'private.entitlements renews_entitlement_id'),
    ('column', 'private.entitlements slot_id'),
    ('column', 'private.payment_lines renews_entitlement_id'),
    ('column', 'private.post_activations continued'),
    ('constraint', 'entitlements_renews_entitlement_id_fkey on private.entitlements'),
    ('constraint', 'entitlements_slot_id_fkey on private.entitlements'),
    ('constraint', 'entitlements_renewal_link on private.entitlements'),
    ('constraint', 'payment_lines_renews_entitlement_id_fkey on private.payment_lines'),
    ('index', 'private.entitlements_renews_active_idx'),
    ('index', 'private.entitlements_renews_entitlement_idx'),
    ('index', 'private.entitlements_slot_idx'),
    ('index', 'private.payment_lines_renews_entitlement_idx'),
    ('trigger', 'entitlements_slot_chain_revoked on private.entitlements'),
    ('view', 'private.public_eligible_posts'),
    ('view', 'private.frontend_restorable_posts'),
    ('kind', 'outbox kind slot_renewal_reminder')
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
  'slot renewals: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; renewal payment lines: '
    || case when not exists (select 1 from pg_attribute a where a.attrelid = 'private.payment_lines'::regclass
           and a.attname = 'renews_entitlement_id' and not a.attisdropped) then 'none (column absent)'
         else (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.payment_lines where renews_entitlement_id is not null', false, true, '')))[1]::text
       end
    || '; renewals issued: '
    || case when not exists (select 1 from pg_attribute a where a.attrelid = 'private.entitlements'::regclass
           and a.attname = 'slot_id' and not a.attisdropped) then 'none (column absent)'
         else (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.entitlements where slot_id is not null', false, true, '')))[1]::text
       end
    || '; reminders queued: '
    || (select count(*) from private.outbox_events o where o.kind = 'slot_renewal_reminder')::text as detail
from state s
union all
select kind, detail from problems;
