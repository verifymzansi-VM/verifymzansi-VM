-- Read-only preflight for updates/20261119151152_package_gap_fixes.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and starts "package gap fixes: update not applied".
--
-- The summary says whether the six functions the update adds, its table and
-- its two indexes are absent and the five functions it replaces
-- (internal.run_slot_renewals, internal.slot_package_grant_revoked,
-- internal.claim_checkout_request, internal.record_staff_invoice_transfer,
-- internal.confirm_staff_invoice_payment) have their reviewed earlier bodies
-- (update not applied), all present with the update's bodies (already
-- applied), or a mix (unexpected state), and counts:
-- - "on sale": whether Multi-listing packages are on sale;
-- - "packages": Multi-listing packages ever opened;
-- - "paused posts to put back": paused posts still held in an ended paid
--   Individual slot that no package takes, whose own end date is later than
--   the slot's paid run (the update's sweep puts them back on its first run);
-- - "unsent package checkouts to refuse": package payments not yet sent to
--   Ozow whose account has a package that has not ended or an unpaid package
--   invoice they are not an attempt of;
-- - "unpaid Individual invoices issued before a package": issued Individual
--   invoices of a person whose running package started after the invoice was
--   issued (a bank transfer to them can be recorded after the update);
-- - "move record": rows of private.slot_package_move_failures ("none (table
--   absent)" before the update).
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.before, v.after,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)), 'absent') as body
  from (values
    ('internal.slot_package_move_failed(uuid,uuid,text,text)', 'absent', 'a202bfe80af8e5021d85c61c954f4afd'),
    ('internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone)', 'absent', 'f12afc45d9dcd4d66a3c426121776f8a'),
    ('internal.slot_package_release_paused(uuid)', 'absent', '7a759a9a2eae8a30e821acb1bc9502af'),
    ('internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone)', 'absent', '936d94bad14a6dd93b088d713d7afc50'),
    ('internal.get_staff_package_move_failures()', 'absent', '68b72b4d76c7326eafa78f4622e96c2c'),
    ('api.get_staff_package_move_failures()', 'absent', '3f539d70b5e2b7e538b77b0eecc94c68'),
    ('internal.run_slot_renewals(integer)', '91941c5d801ac26cb0a8fc98051cd04b', 'f27b3048f7bff4b071a579a5fbf56c98'),
    ('internal.slot_package_grant_revoked()', 'e052094af78e8fe39eeb26f11b8c3e69', '3d22cd9389fa075274e8ba14343e9aea'),
    ('internal.claim_checkout_request(uuid,uuid)', 'ed0fda34dc274593ad117b51d47eb13c', 'cf0116ac2b82826a71f30adbad3309eb'),
    ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)', '6f508a66a82ad2a24e4c43c324fd90a3', 'e37a32a916640c9a16f5924818b9b735'),
    ('internal.confirm_staff_invoice_payment(uuid)', '3daa82e3347ee5e2880279251c9521c2', 'c9adba77f7b7ac7c6366083956e53454')
  ) v(sig, before, after)
),
others as (
  select v.name, to_regclass(v.name) is not null as present
  from (values
    ('private.slot_package_move_failures'),
    ('private.slot_package_move_failures_move_idx'),
    ('private.slot_package_move_failures_last_idx')
  ) v(name)
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
  'package gap fixes: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied'
         else 'unexpected state' end
    || '; on sale: ' || case when coalesce((select x.on_sale from private.slot_package_sales x limit 1), false)
         then 'yes' else 'no' end
    || '; packages: ' || (select count(*) from private.slot_packages)
    || '; paused posts to put back: '
    || (select count(*) from private.post_activations a
          join private.entitlements x on x.id = a.entitlement_id
          join private.posts p on p.id = a.post_id
        where a.released_at is null and a.post_id is not null
          and x.package_id is null and x.source = 'retail_paid' and x.status = 'active'
          and x.ends_at <= statement_timestamp() and p.status = 'paused' and p.kind <> 'event'
          and coalesce(internal.slot_chain_end(x.id) <= statement_timestamp(), true)
          and p.visible_until > internal.slot_chain_paid_end(x.id))
    || '; unsent package checkouts to refuse: '
    || (select count(*) from private.payments pay join private.plan_versions v on v.id = pay.plan_version_id
        where pay.status = 'pending' and pay.checkout_url is null and internal.slot_package_plan(v.plan_code)
          and (internal.slot_package_open(pay.owner_id)
            or exists(select 1 from private.customer_invoices i join private.plan_versions w on w.id = i.plan_version_id
              where i.account_id = pay.owner_id and i.status = 'issued' and internal.slot_package_plan(w.plan_code)
                and not exists(select 1 from private.customer_invoice_payments l
                  where l.invoice_id = i.id and l.payment_id = pay.id))))
    || '; unpaid Individual invoices issued before a package: '
    || (select count(*) from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
        where i.status = 'issued' and internal.individual_slot_plan(v.plan_code)
          and internal.current_verified_identity(i.account_id) is not null
          and internal.slot_package_blocks_individual(internal.current_verified_identity(i.account_id), i.account_id)
          and not exists(select 1 from private.entitlements e join private.slot_packages k on k.id = e.package_id
            where e.owner_id in (select internal.individual_slot_owners(internal.current_verified_identity(i.account_id),
                i.account_id))
              and e.status = 'active' and e.starts_at <= statement_timestamp()
              and e.ends_at > statement_timestamp() + interval '7 days' and k.created_at <= i.issued_at))
    || '; move record: '
    || case when to_regclass('private.slot_package_move_failures') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml('select count(*) as n from private.slot_package_move_failures',
             false, true, '')))[1]::text end as detail
from state s
union all
select kind, detail from problems;
