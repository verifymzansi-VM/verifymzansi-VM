-- Read-only preflight for updates/20261117141803_bank_transfer_expiry.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- Before the update, each bank transfer that has waited 14 days or more is a
-- "problem" row: the update makes it expired at once, and it can never be
-- confirmed after that. Staff confirm it (the money is in the bank) or
-- decline it first, then run this file again.
--
-- The summary says whether the thirteen functions the update replaces have the
-- reviewed earlier bodies and the table has no expired_at column (update not
-- applied), the update's bodies, column and three new commands (already
-- applied), or a mix (unexpected state), and counts:
-- - "waiting": bank transfers waiting for a second staff member;
-- - "waiting 14 days or more": those (they are expired once the update is
--   applied, and the sweep then marks them);
-- - "expired": transfers marked expired (always 0 before the update).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.invoice_transfer_guard()',
      '494dcdb720573571dd36edf97b055332', '40022dab9a8357b0b1ba4101c48f5196'),
    ('internal.confirm_staff_invoice_payment(uuid)',
      'e0c308df14f38f1de76bdced4e8683f2', '66e96f9682fbab67236ccf83142fbd05'),
    ('internal.decline_staff_invoice_payment(uuid,text)',
      'cc8641faee31c5a9a043e4c510d26302', '2812080d676629d5f74e4f4d0063c368'),
    ('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)',
      '594b47bc794e335a3f3be505a4b1637e', 'dbf38f038bee7e1cf43b91288dbdab94'),
    ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)',
      '171c0ad6f18a7f5329ff00dcfff4608d', '4f74538d08ca0abdac2103d71e0fdd07'),
    ('internal.invoice_transfer_dto(private.invoice_transfers,uuid)',
      'b91dbdd96bec847ddb165d6a663cc7cb', '1817387f19f8a1fd9b278247f9e69c15'),
    ('internal.get_staff_invoice_transfers()',
      '37ec35ae8968df035025e3c69234f3be', '13f1c0cf67460052d334b32e70b1ebe8'),
    ('internal.customer_invoice_dto(private.customer_invoices,uuid)',
      '5ce8a88fc44ed9e59a1cfd7dd6214382', '27604995d3de7e7a5794c1bf220b3213'),
    ('internal.start_invoice_payment(text,bigint,boolean)',
      '58e3e24aa91f41a476435c8b152b94d2', 'ea362defef15f7d6116a0f96cc53fef5'),
    ('internal.void_staff_invoice(uuid,text)',
      '21763bcb62e398b6d1b8e8d64ef38ea5', '6c997c846aa9d114150e11d2591d5ad7'),
    ('internal.account_erasure_hold(uuid)',
      '5bd01c33cf23f3e6516ceb96c3dc3236', '42edfda741d3096f7ea7a7b0cb897d49'),
    ('internal.retention_commerce(integer)',
      '422a63c6d6fd2be5a1556893a8975d3f', '55051470a07c224838cb58dc45d66406'),
    ('internal.frontend_privacy_export_data(uuid)',
      '1a16274c11f77a9a6d72482ca43d6753', '86a879279ebd9dcadf6f3f4fa11e7f44')
  ) v(sig, reviewed, updated)
),
added as (
  select exists(select 1 from pg_attribute a where a.attrelid = 'private.invoice_transfers'::regclass
      and a.attname = 'expired_at' and not a.attisdropped) as column_added,
    to_regprocedure('api.expire_waiting_bank_transfers(integer)') is not null
      and to_regprocedure('api.get_staff_expired_invoice_transfers()') is not null
      and to_regprocedure('api.get_my_invoice_transfer_expiry(text)') is not null
      and to_regprocedure('api.resolve_expired_invoice_transfer(uuid,text,text)') is not null as commands_added
),
state as (
  select bool_and(b.body is not distinct from b.reviewed) and not bool_or(a.column_added) as absent,
    bool_and(b.body is not distinct from b.updated) and bool_and(a.column_added) and bool_and(a.commands_added) as applied
  from bodies b cross join added a
),
overdue as (
  select t.id, t.recorded_at, t.amount_received_cents, t.bank_reference
  from private.invoice_transfers t
  where t.status = 'awaiting_confirmation' and t.recorded_at <= statement_timestamp() - interval '14 days'
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
  from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem',
    'bank transfer ' || o.id || ' (' || o.bank_reference || ', ' || o.amount_received_cents || ' cents) recorded '
      || to_char(o.recorded_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD')
      || ' has waited 14 days or more: confirm or decline it before applying the update'
  from overdue o cross join state s where not s.applied
)
select 'summary' as kind,
  'bank transfer expiry: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; waiting: '
    || (select count(*) from private.invoice_transfers t where t.status = 'awaiting_confirmation')
    || '; waiting 14 days or more: '
    || (select count(*) from overdue)
    || '; expired: '
    || (select count(*) from private.invoice_transfers t where t.status = 'expired') as detail
from state s
union all
select kind, detail from problems;
