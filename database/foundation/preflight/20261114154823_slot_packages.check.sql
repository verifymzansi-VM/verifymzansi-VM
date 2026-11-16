-- Read-only preflight for updates/20261114154823_slot_packages.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (its new functions, tables,
-- columns, constraints, indexes and trigger are absent and the twenty
-- functions it replaces have the earlier bodies) or applied (every body,
-- table, column, constraint, index and trigger is the update's), whether
-- packages are on sale, and counts the packages and the package payments once
-- applied. A problem row is shown when a function or view the update builds
-- on is not the reviewed one, or a function it replaces is neither the
-- earlier reviewed body nor the update's.
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.slot_package_guard()', 'be264c746997a4b200c3db5ab0a04fca'),
    ('internal.slot_package_plan(text)', '30b630774b28697f96b1b76978083e07'),
    ('internal.slot_packages_on_sale()', '655bac7e53015b7ece5bc23fba1fa3fa'),
    ('internal.slot_chain_paid_end(uuid)', 'de3528681a1ad52128c6db296e413d12'),
    ('internal.slot_package_now(uuid)', 'a561555c6a51e7b33dfe29dbc55f32de'),
    ('internal.slot_package_posts(uuid)', '4571c82bda496cfa2ea35058be045d9a'),
    ('internal.slot_package_waiting(uuid,interval)', '90cd762132b7d7a4abc43dbd1c25ab95'),
    ('internal.slot_package_release_dates(uuid)', '1ac622530ea299d7d511e08845503fb6'),
    ('internal.slot_package_grant_revoked()', '9cf14c5d2537f7839e2dc50824c43baf'),
    ('internal.slot_package_leaving(uuid)', 'eb4f4cfd0ba7bda9931ec9731f2cffae'),
    ('internal.individual_free_places(uuid)', '94a6acaa2a052aa6cb13df7a434907ec'),
    ('internal.slot_package_takeover_end(uuid)', '0a77a9c7ebbf989e9441f7c55586a716'),
    ('internal.slot_package_open(uuid)', 'caeeac35f9854e2c7c4155e73bf01a5d'),
    ('internal.slot_package_blocks_individual(text,uuid)', 'aaacd9fa58c26ece264cca8ed0340102'),
    ('internal.refresh_package_documents(uuid)', 'f77541c993abcff9ac23695d27f34dbf'),
    ('internal.start_package_checkout(uuid,integer,bigint,boolean)', 'feb6e6f31e0bc1f6a1de41e8c927acb8'),
    ('api.start_package_checkout(uuid,integer,bigint,boolean)', 'fd80319b7272002223740642d8e6f2e1'),
    ('internal.get_slot_package_offer()', '2e254cb01e76b57f42c0505fc8561867'),
    ('api.get_slot_package_offer()', 'ea9f10b3de795636e6261df26cd820b1'),
    ('internal.get_my_slot_package()', '94c2adc7b69ccdc80d6ca8adb083143b'),
    ('api.get_my_slot_package()', '484fbb096937f82b0669ed231e0edfef')
  ) v(sig, after)
),
changed as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.slot_chain_end(uuid)', 'de3528681a1ad52128c6db296e413d12', 'fe36eb29f4128a1eef3c967c9c501c76'),
    ('internal.slot_posts_held(uuid)', '991f2a39a08f79399bb502e1a382d2dc', '79a8a8cbd5e2a5208cb885bcfce222ef'),
    ('internal.slot_posts_started(uuid,timestamp with time zone)', '1792e3af738c40f7f412198a47859398', 'b4c766fe4de985334272296045f529e8'),
    ('internal.activate_post(uuid)', 'bc99d728b6a6e4465b87b0fd607aeb08', '114605168a14a5cf9b7619f23d3d198e'),
    ('internal.issue_slot_line_entitlements(uuid)', '85ae00308b9abb35c6c13bc67821d39d', 'e4041c30d7297bc4b4da74791701627d'),
    ('internal.apply_provider_event(jsonb)', '19d5c2eb7e1a75210bc2b77d2cbb961b', '7f33edbb6bcafaecb519eef80c9b3633'),
    ('internal.activate_staff_paid_payment(uuid,text)', '03c8a3314cd99f02fb465a391ca2942f', '324f8855e844937190754f70c03fcd2e'),
    ('internal.start_slot_checkout(uuid,integer,bigint,boolean)', '4ce514eae4c2fb3fd9b0a0ecc40ac498', 'cae84c17b05a49fc3937064eaaff38f2'),
    ('internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)', '94de32ca80099d59db23aed33c6e7ee2', 'e014633dd37ebb3fa212fc2944dd7ed6'),
    ('internal.run_slot_renewals(integer)', 'db9fd3d09dd015c5de40da964d6f8825', '6883b7f62518b33caaf127d300ea0864'),
    ('internal.manage_plan_member(uuid,text,text)', '39d6eba6a1db025d4ae0655d34870f96', '285ce1cc4dc56a1e262811362a345da8'),
    ('internal.claim_checkout_request(uuid,uuid)', 'd29afcd49f72e712602914d6ecb4d8f5', '0234950a11ec46ce9ccb0e707b940e72'),
    ('internal.get_my_frontend_post_manager()', 'a435e97820a6788e8203c2af447c0f42', 'c408ccd9ee1a2cc4f135f2b4032f6583'),
    ('internal.retention_commerce(integer)', '06d7529db4898b7bb3b158d38a1d5929', '422a63c6d6fd2be5a1556893a8975d3f'),
    ('internal.frontend_privacy_export_data(uuid)', '03c73dba3ba38c4866186a8b84b4a521', '1a16274c11f77a9a6d72482ca43d6753'),
    ('internal.issue_staff_invoice(text,integer,integer,integer,text,uuid)', '2c707542a6b970d11d278df749674b9b', 'cd64d93855e2db900d3600321759a07f'),
    ('internal.start_invoice_payment(text,bigint,boolean)', '1bc2224ded0d1a5ddd03382f1fc2a46f', '157a3a3a51c3abfdef565e37a2af3785'),
    ('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)', 'e02d131400fd0ac64c4d50e616dc4be7', '594b47bc794e335a3f3be505a4b1637e'),
    ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)', '368a7de259a913eddf339bf718abba24', '171c0ad6f18a7f5329ff00dcfff4608d'),
    ('internal.confirm_staff_invoice_payment(uuid)', 'cae341b6ac2373b82529618276d0bfb5', 'e0c308df14f38f1de76bdced4e8683f2')
  ) v(sig, before, after)
),
needed as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.price_draft_actor()', '1d70271a4447ba5d1377f3f64a6cf029'),
    ('internal.lock_evidence_subject(uuid)', '3ef77cf81542607c0ba91f6687255f01'),
    ('internal.individual_slot_plan(text)', 'c0c1d06dc52122641d02db6b1364be75'),
    ('internal.individual_slot_owners(text,uuid)', '49c59acc8f02fcb09e757c0584b7de51'),
    ('internal.individual_slot_identity(uuid)', '4e4552c83cb629e96f1300060eeff16b'),
    ('internal.individual_slot_limit(text)', '90ecd5c02572cc9831468458f3ae0e2d'),
    ('internal.individual_slots_counted(text,uuid,uuid)', '4213e64e4b2fb9f8062fe02277a28e69'),
    ('internal.individual_renewals_allowed(text,uuid,uuid,uuid[])', '0012cbcef8b31da4ed93ee267ca13afd'),
    ('internal.slot_lines_adding(uuid)', '74fe04e6cff80dece687c24e05c18fb7'),
    ('internal.slot_lines_renewing(uuid)', '9ce02eccc93128dff9142cb06db0efe6'),
    ('internal.slot_chain_held(uuid)', '23b8b9c552d561b4f2d818e9d5056f61'),
    ('internal.slot_chain_last_end(uuid)', 'b1751aee92ddb5d65ed0c95a0bc1b8ea'),
    ('internal.slot_renewal_window()', 'c238f2c972a2f767c6a70d939d552000'),
    ('internal.slot_renewal_due(uuid,uuid)', 'f0eb3360c8456cc4b191c315c61c482e'),
    ('internal.refresh_slot_chain_documents(uuid)', '8654d4f1d0886ad9e877835077a2ad3d'),
    ('internal.entitlement_for_post_eligible(uuid,uuid,uuid)', 'd3861dfcebe2d7e1d6955a0c549b2db3'),
    ('internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone)', '0db72b1ee054a2d8dd1b946d73c58e41'),
    ('internal.slot_grant_usable(uuid,text,timestamp with time zone,timestamp with time zone)', 'b43abb8cb82c15c1a3f240680d3710ac'),
    ('internal.post_funding(uuid)', '16c30a8438ae9d43796f5f78f4144ad0'),
    ('internal.post_shown_until(uuid,text,timestamp with time zone)', '38dd9acbfe8fe8cee3f4b894e1075d6f'),
    ('internal.run_post_lifecycle(integer)', 'cb5770e3e71e9e6ed31d1eff3e06e3fc'),
    ('internal.customer_invoice_settled_elsewhere(uuid)', 'eab13db8976c5bcde805288faec9591c'),
    ('internal.addon_purchase_entitlement(uuid,uuid,text)', '2cd60895de8dad14dfe1d1f26ae83543'),
    ('internal.payment_invoice_vat(private.payments)', '8ba4ca6c4ea0207abece5a9fdc57336e'),
    ('internal.payment_delivery_commission(uuid)', '173b97b47147f69d097daba72def56d9'),
    ('internal.payment_partner_commission()', 'e99f071fae090328566a61186843c6e2'),
    ('internal.payment_line_guard()', 'b15e1db8b48ae9de6b4372ecef62ceed'),
    ('internal.reverse_payment_line(uuid,text,text,uuid)', '3f95168e1faacac2ca6f1431962c182c'),
    ('internal.reverse_payment(uuid,text,text)', '66005adb9e06b17e689dbac47ce93d5a'),
    ('internal.staff_actor(text)', '269f0871f156f57c029cedcab72f6c3f'),
    ('internal.assert_staff_payment_actor(uuid,uuid)', 'fe81cc39557206e06346fcf5e9f33bfd'),
    ('internal.plain_text_valid(text,integer,integer,boolean)', 'b3654008b4427d60db398555fef16971')
  ) v(sig, reviewed)
),
views as (
  select v.name, v.reviewed,
    md5(replace(pg_get_viewdef(to_regclass(v.name), true), E'\r\n', E'\n')) as body
  from (values
    ('private.public_eligible_posts', '921182c5875ae0f33536c11e2b85c8a2'),
    ('private.frontend_restorable_posts', '715c8d00fa79df66d1c0544283ea3ff5')
  ) v(name, reviewed)
),
others as (
  select v.name,
    case v.kind
      when 'table' then to_regclass(v.name) is not null
      when 'column' then exists (select 1 from pg_attribute a where a.attrelid = to_regclass(split_part(v.name, ' ', 1))
        and a.attname = split_part(v.name, ' ', 2) and not a.attisdropped)
      when 'constraint' then exists (select 1 from pg_constraint c where c.conname = split_part(v.name, ' on ', 1)
        and c.conrelid = to_regclass(split_part(v.name, ' on ', 2)))
      when 'index' then to_regclass(v.name) is not null
      when 'trigger' then exists (select 1 from pg_trigger t where t.tgname = split_part(v.name, ' on ', 1)
        and not t.tgisinternal and t.tgrelid = to_regclass(split_part(v.name, ' on ', 2)))
    end as present
  from (values
    ('table', 'private.slot_packages'),
    ('table', 'private.slot_package_sales'),
    ('column', 'private.entitlements package_id'),
    ('column', 'private.payment_lines slot_count'),
    ('constraint', 'payment_lines_slot_count_check on private.payment_lines'),
    ('constraint', 'entitlements_package_id_fkey on private.entitlements'),
    ('constraint', 'entitlements_package_grant on private.entitlements'),
    ('index', 'private.slot_packages_owner_idx'),
    ('index', 'private.entitlements_package_idx'),
    ('index', 'private.entitlements_package_ends_idx'),
    ('index', 'private.post_activations_owner_held_idx'),
    ('trigger', 'slot_packages_immutable on private.slot_packages'),
    ('trigger', 'entitlements_package_revoked on private.entitlements')
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
  select 'problem', name || ' is not the reviewed view this update builds on (md5 ' || coalesce(body, 'missing')
      || '); do not apply the update'
    from views where body is distinct from reviewed
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from added where body is not null and body is distinct from after)
)
select 'summary' as kind,
  'slot packages: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; on sale: '
    || case when to_regclass('private.slot_package_sales') is null then 'no (switch absent)'
         when (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.slot_package_sales where on_sale', false, true, '')))[1]::text = '0'
           then 'no' else 'YES' end
    || '; packages: '
    || case when to_regclass('private.slot_packages') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.slot_packages', false, true, '')))[1]::text
       end
    || '; package payments: '
    || (select count(*) from private.payments p join private.plan_versions v on v.id = p.plan_version_id
        where v.plan_code in ('slot_package_30d', 'slot_package_90d', 'slot_package_180d'))::text as detail
from state s
union all
select kind, detail from problems;
