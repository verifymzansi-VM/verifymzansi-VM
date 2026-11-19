-- Read-only preflight for updates/20261119025106_package_invoices.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and starts "package invoices: update not applied".
--
-- The summary says whether the nine functions the update replaces have the
-- reviewed earlier bodies and the eighteen it adds, its table, trigger and
-- wider invoice limits are absent (update not applied), all present with the
-- update's bodies (already applied), or a mix (unexpected state), and counts:
-- - "on sale": whether Multi-listing packages are on sale (they must stay off
--   until the owner switches them on);
-- - "invoice requests": members' requests for a package invoice (and how many
--   are open);
-- - "package invoices": customer invoices for a package;
-- - "package bank transfers": bank transfers recorded against them.
do $$begin
  set transaction read only;
end$$;
with changed as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.start_invoice_payment(text,bigint,boolean)',
      'ea362defef15f7d6116a0f96cc53fef5', 'a43e58e5ebc85179c901428e4f0f805e'),
    ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)',
      '9e52c2ebd9dae698e4b7ee59904d4c46', '6f508a66a82ad2a24e4c43c324fd90a3'),
    ('internal.confirm_staff_invoice_payment(uuid)',
      '0ccc38ab7e5dff36bf27b4047c58b218', '3daa82e3347ee5e2880279251c9521c2'),
    ('internal.frontend_privacy_export_data(uuid)',
      '86a879279ebd9dcadf6f3f4fa11e7f44', '0b4cd3f792ffecf94c329277db4da28e'),
    ('internal.customer_invoice_payment_guard()',
      '7ad52ae1b3e37ad792d8dca2a275ca96', '397c6a0239c508923a8215b2953d23d5'),
    ('internal.start_package_checkout(uuid,integer,bigint,boolean)',
      '947486cd48be84b7a45714ec51d1bae4', 'd5d9713994c8789030bd30c90c4c00b5'),
    ('internal.close_account_evidence(uuid)',
      '0300a2d267a77b797d7316a4cdf43e75', 'ae0f20403df41b820bad1c96d93a0be1'),
    ('internal.erase_closed_account(uuid,text)',
      '1dc0781f7497f50fd305dd0903b37ec5', '0110024c386259da47b96caf79555bac'),
    ('internal.retention_commerce(integer)',
      '55051470a07c224838cb58dc45d66406', '755823787c716f14012a64aad254134d')
  ) v(sig, before, after)
),
added as (
  select v.schema_name || '.' || v.name as sig, v.after,
    (select string_agg(md5(replace(p.prosrc, E'\r\n', E'\n')), ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = v.schema_name and p.proname = v.name) as body
  from (values
    ('internal', 'package_invoice_request_guard', 'e41853f9d3e75297df7a4bf00e736792'),
    ('internal', 'package_invoice_approval_above_cents', 'b775e7ca727cdf3583b884cf83106404'),
    ('internal', 'package_invoice_request_dto', '16fb4eae547a00d51cf95b55adc16dda'),
    ('internal', 'package_invoice_issue_check', 'e0ae2e35373cba98b3cb385d07871377'),
    ('internal', 'issue_package_customer_invoice', '117d33c9a93c2d965e138a7fdc7930b8'),
    ('internal', 'request_package_invoice', 'beb95771af677d39b775e83197dfd8d1'),
    ('api', 'request_package_invoice', '096d60996af28df5e8aaa0d5fe51918d'),
    ('internal', 'get_my_package_invoice_request', 'f46514db5c5524de116f099e0794a89b'),
    ('api', 'get_my_package_invoice_request', '5208556a35b7224da595e8cbc7e65b4d'),
    ('internal', 'get_staff_package_invoice_requests', '30e148de7bfe9c6730218c712a622710'),
    ('api', 'get_staff_package_invoice_requests', '7662153696a6e67c6b58431e88285f16'),
    ('internal', 'lock_package_invoice_request', 'c61bd2426d996277afa7d62b4e34c047'),
    ('internal', 'issue_staff_package_invoice', 'a69a568ea6d0173b70b2cc924da1c548'),
    ('api', 'issue_staff_package_invoice', '9df49639f4e8861953faf6a8972e237a'),
    ('internal', 'approve_staff_package_invoice', 'f8666f0fef8839ad924daaff4d99d2bf'),
    ('api', 'approve_staff_package_invoice', 'fe1e424c2d010af354ee0bff1eb6b43b'),
    ('internal', 'decline_staff_package_invoice_request', '74afb491d3b43b9ba6d0f77af7c75e14'),
    ('api', 'decline_staff_package_invoice_request', '2f6a2b27f80e7e808bd14c2ace784e53')
  ) v(schema_name, name, after)
),
others as (
  select v.name,
    case v.kind
      when 'table' then to_regclass(v.name) is not null
      when 'trigger' then exists (select 1 from pg_trigger t where t.tgname = split_part(v.name, ' on ', 1)
        and not t.tgisinternal and t.tgrelid = to_regclass(split_part(v.name, ' on ', 2)))
      when 'check' then exists (select 1 from pg_constraint c where c.conname = split_part(v.name, ' on ', 1)
        and c.conrelid = to_regclass(split_part(v.name, ' on ', 2))
        and (pg_get_constraintdef(c.oid) like '%<= 250)%' or pg_get_constraintdef(c.oid) like '%<= 15000000)%'))
    end as present
  from (values
    ('table', 'private.package_invoice_requests'),
    ('trigger', 'package_invoice_requests_guard on private.package_invoice_requests'),
    ('check', 'customer_invoices_slots_check on private.customer_invoices'),
    ('check', 'customer_invoices_total_cents_check on private.customer_invoices'),
    ('check', 'invoice_transfers_slots_check on private.invoice_transfers'),
    ('check', 'invoice_transfers_amount_received_cents_check on private.invoice_transfers'),
    ('check', 'payment_lines_amount_cents_check on private.payment_lines')
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
  select 'problem', sig || ' is neither the reviewed body nor the update''s (md5 ' || coalesce(body, 'missing')
      || '); do not apply the update'
    from changed where body is distinct from before and body is distinct from after
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from added where body is not null and body is distinct from after)
      and not exists (select 1 from changed where body is distinct from before and body is distinct from after)
)
select 'summary' as kind,
  'package invoices: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; on sale: '
    || case when exists (select 1 from private.slot_package_sales x where x.on_sale) then 'YES' else 'no' end
    || '; invoice requests: '
    || case when to_regclass('private.package_invoice_requests') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.package_invoice_requests', false, true, '')))[1]::text
           || ' (open: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.package_invoice_requests where status in (''requested'', ''awaiting_approval'')',
             false, true, '')))[1]::text || ')'
       end
    || '; package invoices: '
    || (select count(*) from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
        where v.plan_code in ('slot_package_30d', 'slot_package_90d', 'slot_package_180d'))::text
    || '; package bank transfers: '
    || (select count(*) from private.invoice_transfers t join private.plan_versions v on v.id = t.plan_version_id
        where v.plan_code in ('slot_package_30d', 'slot_package_90d', 'slot_package_180d'))::text as detail
from state s
union all
select kind, detail from problems;
