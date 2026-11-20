-- Read-only preflight for updates/20261120045404_package_add_slots.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and starts "package add slots: update not applied".
--
-- The summary says whether the fourteen functions the update adds, its four
-- columns, three constraints and one index of private.package_invoice_requests
-- and its void rule of private.customer_invoices are absent and the seventeen
-- functions it replaces have their reviewed earlier bodies
-- (update not applied), all present with the update's bodies (already
-- applied), or a mix (unexpected state), and counts:
-- - "on sale": whether Multi-listing packages are on sale;
-- - "packages running": Multi-listing packages that have not ended;
-- - "package invoice requests": rows of private.package_invoice_requests;
-- - "added-slots requests": requests of kind `add` ("none (column absent)"
--   before the update);
-- - "added-slots payments": payments whose snapshot is an add (none before
--   the update);
-- - "invoices voided by the database": unpaid added-slots invoices whose
--   package ended (none before the update).
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.before, v.after,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)), 'absent') as body
  from (values
    -- each: the function, its body before the update, its body after it
    ('internal.slot_package_term_plan(integer)', 'absent', '0d8726c18c52a84d92c5badfddc10482'),
    ('internal.slot_package_add_quote(uuid)', 'absent', '233e14908c1d2b21b17a9205da371a77'),
    ('internal.slot_package_add_ok(uuid,uuid,integer)', 'absent', '27fc89e79b7b625096fe2219fd567aaa'),
    ('internal.package_add_invoice_package(uuid)', 'absent', '1c6cab90a756caa366bb753b0af5b18e'),
    ('internal.slot_package_keep_posts(uuid)', 'absent', '3618e3c5cd90a9c5bc5c081432c4333b'),
    ('internal.get_my_package_add_offer()', 'absent', '9ae9f7cb7a1c18ec5a1b769e85c83eac'),
    ('internal.start_package_add_checkout(uuid,integer,bigint,boolean)', 'absent', '2c803b109be23131c9b0cd2b1d05cba7'),
    ('internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)', 'absent', '3e7bd289c5fd516312b752920d4237b8'),
    ('api.get_my_package_add_offer()', 'absent', '4b7a12f241f9fdc5ec61545eaac6fa2b'),
    ('api.start_package_add_checkout(uuid,integer,bigint,boolean)', 'absent', '3be278362296fc2ec9cc5fdfbb256593'),
    ('api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)', 'absent', '6a61e0b25fc1600829ac3c13f1d22a67'),
    ('internal.package_invoice_blocking(uuid,uuid)', 'absent', '460577dbfc512edb1f9a6576dc8b2d73'),
    ('internal.void_ended_package_add_invoices(integer)', 'absent', '01d78539331e4875d06cd138089531e7'),
    ('api.void_ended_package_add_invoices(integer)', 'absent', 'ff2882aa42979545ada32c671ff1a408'),
    ('internal.issue_slot_line_entitlements(uuid)', '3d167ce1ce2bcc4a84480b8ed7888e0a', 'b81aadc5fd06b47c33fc96b81d49b586'),
    ('internal.apply_provider_event(jsonb)', '7f33edbb6bcafaecb519eef80c9b3633', '3a7487b374df1d1334d007111fd1d97f'),
    ('internal.activate_staff_paid_payment(uuid,text)', '324f8855e844937190754f70c03fcd2e', '369ef2cc3b3a3139cfe83a3e7edb74eb'),
    ('internal.claim_checkout_request(uuid,uuid)', '4922a976d1652603d491349a40f4f7da', '9d136593beb5f0e4aef35cb1f5fd5c75'),
    ('internal.slot_package_grant_revoked()', '3d22cd9389fa075274e8ba14343e9aea', '0f5b47f62caf51472e9da4987958ec28'),
    ('internal.package_invoice_request_guard()', 'e41853f9d3e75297df7a4bf00e736792', '6278c187470a7908134ebed5ec72939f'),
    ('internal.package_invoice_request_dto(private.package_invoice_requests,uuid)', '16fb4eae547a00d51cf95b55adc16dda', '7de219f93bdf5de34c73c1c10642129a'),
    ('internal.package_invoice_issue_check(private.package_invoice_requests)', 'e0ae2e35373cba98b3cb385d07871377', '28d36c25e3b05d045286b1584a8d529c'),
    ('internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text)', '117d33c9a93c2d965e138a7fdc7930b8', 'cc5a02870820c4b28ab8af83baf1654c'),
    ('internal.start_invoice_payment(text,bigint,boolean)', 'a43e58e5ebc85179c901428e4f0f805e', '3637cefdf51809d67891104e041d71da'),
    ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)', 'e37a32a916640c9a16f5924818b9b735', '0f3f117b8bed207a401030c3bfb429df'),
    ('internal.confirm_staff_invoice_payment(uuid)', 'c9adba77f7b7ac7c6366083956e53454', 'ff40d1c2cf36149d535a4fdb7d99f1bf'),
    ('internal.customer_invoice_dto(private.customer_invoices,uuid)', '27604995d3de7e7a5794c1bf220b3213', 'b322c8309ff009f5ef969862b4b77d89'),
    ('internal.request_package_invoice(uuid,integer,bigint,boolean,uuid)', 'beb95771af677d39b775e83197dfd8d1', 'f64d310d8ca3a549840db98df6f083f9'),
    ('internal.get_my_package_invoice_request()', 'f46514db5c5524de116f099e0794a89b', 'd3f564bbfb6271560c72f0aaf1af047a'),
    ('internal.start_package_checkout(uuid,integer,bigint,boolean)', 'd5d9713994c8789030bd30c90c4c00b5', '26868efedb8522c1e933278ed52dfaad'),
    ('internal.frontend_privacy_export_data(uuid)', '3dfe35ae5e93f0661ecd7dbf710cf45d', 'e543b105fe264d5a683b5c570bf68cb5')
  ) v(sig, before, after)
),
others as (
  select v.present
  from (values
    (exists(select 1 from pg_attribute a where a.attrelid = 'private.package_invoice_requests'::regclass
      and a.attname = 'kind' and not a.attisdropped)),
    (exists(select 1 from pg_attribute a where a.attrelid = 'private.package_invoice_requests'::regclass
      and a.attname = 'package_id' and not a.attisdropped)),
    (exists(select 1 from pg_attribute a where a.attrelid = 'private.package_invoice_requests'::regclass
      and a.attname = 'days_left' and not a.attisdropped)),
    (exists(select 1 from pg_constraint c where c.conrelid = 'private.package_invoice_requests'::regclass
      and c.conname = 'package_invoice_requests_kind_check')),
    (exists(select 1 from pg_constraint c where c.conrelid = 'private.package_invoice_requests'::regclass
      and c.conname = 'package_invoice_requests_add')),
    (exists(select 1 from pg_attribute a where a.attrelid = 'private.package_invoice_requests'::regclass
      and a.attname = 'invoiced_days' and not a.attisdropped)),
    (exists(select 1 from pg_constraint c where c.conrelid = 'private.package_invoice_requests'::regclass
      and c.conname = 'package_invoice_requests_package_id_fkey')),
    (to_regclass('private.package_invoice_requests_package_idx') is not null),
    (exists(select 1 from pg_constraint c where c.conrelid = 'private.customer_invoices'::regclass
      and c.conname = 'customer_invoices_void' and pg_get_constraintdef(c.oid) like '%ended before the invoice was paid%'))
  ) v(present)
),
state as (
  select
    (select count(*) from added where body = before) + (select count(*) from others where not present) as absent,
    (select count(*) from added where body = after) + (select count(*) from others where present) as updated,
    (select count(*) from added) + (select count(*) from others) as total
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
    from added where body <> before and body <> after
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from added where body <> before and body <> after)
)
select 'summary' as kind,
  'package add slots: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied'
         else 'unexpected state' end
    || '; on sale: ' || case when coalesce((select x.on_sale from private.slot_package_sales x limit 1), false)
         then 'yes' else 'no' end
    || '; packages running: ' || (select count(distinct e.package_id) from private.entitlements e
         where e.package_id is not null and e.status = 'active' and e.ends_at > statement_timestamp())
    || '; package invoice requests: ' || (select count(*) from private.package_invoice_requests)
    || '; added-slots requests: '
    || case when not exists(select 1 from pg_attribute a where a.attrelid = 'private.package_invoice_requests'::regclass
           and a.attname = 'kind' and not a.attisdropped) then 'none (column absent)'
         else (xpath('/row/n/text()', query_to_xml(
           'select count(*) as n from private.package_invoice_requests where kind = ''add''',
           false, true, '')))[1]::text end
    || '; added-slots payments: ' || (select count(*) from private.payments p
         where p.snapshot->>'category' = 'slot_package_add')
    || '; invoices voided by the database: ' || (select count(*) from private.customer_invoices i
         where i.status = 'void' and i.voided_by is null) as detail
from state s
union all
select kind, detail from problems;
