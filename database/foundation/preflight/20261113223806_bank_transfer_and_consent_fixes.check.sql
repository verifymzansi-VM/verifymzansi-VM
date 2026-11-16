-- Read-only preflight for updates/20261113223806_bank_transfer_and_consent_fixes.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (every function it replaces
-- has the earlier reviewed body, its three new functions and its trigger are
-- absent, bank references are unique across every record and refund
-- references have no spaces) or applied (every body, the index, the trigger
-- and the reference rule are the update's). It also counts the declined bank
-- transfers, the bank references now recorded more than once and the refund
-- references with a space; the last two must be 0 for the rollback to work.
-- A problem row is shown when a function it calls is not the reviewed body.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.before, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)', '6b00db574fbf4056485339f1766460b9', 'fa71c56d4a686ea343f23d551985af9e'),
    ('internal.invoice_transfer_dto(private.invoice_transfers,uuid)', '271116a2ef1b920f162c0c6e3dd9d367', 'b91dbdd96bec847ddb165d6a663cc7cb'),
    ('internal.get_payment_receipt(uuid)', '82b6d1f1a4f8f1b7e1325c71146b453d', '764707a2ed4f9c87985e88b1afcde37c'),
    ('internal.record_staff_payment_refund(uuid,text,text,text,text)', '03691c9ff0eb92fed4be87b11c1fb15b', '49d728545decec524a1a7dd6e09639e1'),
    ('internal.record_staff_slot_refund(uuid,text,text,text,text)', 'a315072d628da2b6f164491cbc1a0076', 'cbea96f3d2df4f3255c565790df97fed'),
    ('internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text)', '6e38d5e6f28b5ed84b79388329effc18', '31f93ac046f3cb4b73bc6896e8e4d2a3'),
    ('internal.frontend_privacy_export_data(uuid)', '364c075188caa06e95654bc787256078', 'd30c545386536a718e824d1ec56f03ce'),
    ('internal.retention_verification(integer)', '8ec82ea0aadf31494bebb7a28d5640a5', 'fe726b6672545b8b33901361eaf91226'),
    ('internal.list_my_email_history(integer)', '4b43516e282fc258bf747c427f4c18e0', 'bae293aa4451ea71502c27863c1cf5e6'),
    ('internal.staff_refund_reference(uuid,text)', null, 'ae254508232ecdd23136e0d47549673f'),
    ('internal.assert_staff_refund_reason(text,text,text)', null, '9bdc2d6c07af6313c21463bd5fdca8d0'),
    ('internal.payment_refund_reference_rule()', null, '5f84fd9a07a75476cf72b741b20f5806')
  ) v(sig, before, after)
),
needed as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.consent_actor()', '099a58b1b468c01729de1ee233a6de84'),
    ('internal.guard_consent_record()', '0efc7c208cfc205c057c1015781cfd71'),
    ('internal.record_staff_slot_reversal(uuid,text,text)', '1364f8c78e36281bae5f16a4ba5a466c'),
    ('internal.reverse_payment(uuid,text,text)', '66005adb9e06b17e689dbac47ce93d5a'),
    ('internal.refund_needs_approval(text,bigint,bigint)', '7f3795506bf5dedfc96e78c6adb0b1ff'),
    ('internal.assert_staff_payment_actor(uuid,uuid)', 'fe81cc39557206e06346fcf5e9f33bfd')
  ) v(sig, reviewed)
),
others as (
  select
    pg_get_indexdef(to_regclass('private.invoice_transfers_reference_idx')) as old_index,
    pg_get_indexdef(to_regclass('private.invoice_transfers_open_reference_idx')) as new_index,
    (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = to_regclass('private.payment_refund_requests')
      and c.conname = 'payment_refund_requests_ozow_reference_check') as reference_rule,
    exists (select 1 from pg_trigger t where t.tgname = 'payment_refund_requests_reference_rule' and not t.tgisinternal
      and t.tgrelid = to_regclass('private.payment_refund_requests')) as trigger_present
),
rules as (
  select
    old_index is not distinct from 'CREATE UNIQUE INDEX invoice_transfers_reference_idx ON private.invoice_transfers USING btree (upper(regexp_replace(bank_reference, ''[^A-Za-z0-9]''::text, ''''::text, ''g''::text)))'
      and new_index is null as index_before,
    old_index is null and new_index is not distinct from 'CREATE UNIQUE INDEX invoice_transfers_open_reference_idx ON private.invoice_transfers USING btree (upper(regexp_replace(bank_reference, ''[^A-Za-z0-9]''::text, ''''::text, ''g''::text)), amount_received_cents, cleared_on) WHERE (status <> ''declined''::text)'
      as index_after,
    reference_rule is not distinct from 'CHECK ((ozow_reference ~ ''^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$''::text))' as rule_before,
    reference_rule is not distinct from 'CHECK (((ozow_reference ~ ''^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,99}$''::text) AND (ozow_reference = btrim(ozow_reference)) AND (ozow_reference !~~ ''%  %''::text)))' as rule_after,
    trigger_present
  from others
),
state as (
  select
    (select count(*) from bodies where body is not distinct from before)
      + (select index_before::int + rule_before::int + (not trigger_present)::int from rules) as absent,
    (select count(*) from bodies where body = after)
      + (select index_after::int + rule_after::int + trigger_present::int from rules) as updated,
    (select count(*) from bodies) + 3 as total
),
problems as (
  select 'problem' as kind, sig || ' is neither the earlier reviewed body nor the update''s (md5 ' || coalesce(body, 'missing')
      || '); do not apply the update' as detail
    from bodies where body is distinct from before and body is distinct from after
  union all
  select 'problem', sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing')
      || '); apply 20261113134500 and 20261113162457 first'
    from needed where body is distinct from reviewed
  union all
  select 'problem', 'a bank reference index or the refund reference rule is neither the earlier nor the update''s; do not apply the update'
    from rules where not ((index_before or index_after) and (rule_before or rule_after))
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from bodies where body is distinct from before and body is distinct from after)
)
select 'summary' as kind,
  'bank transfer and consent fixes: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied'
         else 'unexpected state' end
    || '; declined bank transfers: '
    || (select count(*) from private.invoice_transfers where status = 'declined')
    || '; bank references recorded more than once: '
    || (select count(*) from (select 1 from private.invoice_transfers
         group by upper(regexp_replace(bank_reference, '[^A-Za-z0-9]', '', 'g')) having count(*) > 1) d)
    || '; refund references with a space: '
    || (select count(*) from private.payment_refund_requests where position(' ' in ozow_reference) > 0) as detail
from state s
union all
select kind, detail from problems;
