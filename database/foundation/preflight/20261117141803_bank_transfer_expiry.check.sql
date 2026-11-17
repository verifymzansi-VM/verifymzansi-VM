-- Read-only preflight for updates/20261117141803_bank_transfer_expiry.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the six functions the update replaces have the
-- reviewed earlier bodies and the table has no expired_at column (update not
-- applied), the update's bodies, column and three new commands (already
-- applied), or a mix (unexpected state), and counts:
-- - "waiting": bank transfers waiting for a second staff member;
-- - "waiting 14 days or more": those the first sweep after the website release
--   will mark expired (it releases their invoices, as a decline does);
-- - "expired": transfers already expired (always 0 before the update).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.invoice_transfer_guard()',
      '494dcdb720573571dd36edf97b055332', 'af70f9825c745ba7b8befd4fac7eb172'),
    ('internal.confirm_staff_invoice_payment(uuid)',
      'e0c308df14f38f1de76bdced4e8683f2', 'd5e6989a1e81cd2936ed9294aecb4574'),
    ('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)',
      '594b47bc794e335a3f3be505a4b1637e', '76c273eb51960b75755d1adf6725772f'),
    ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)',
      '171c0ad6f18a7f5329ff00dcfff4608d', '131c741d783cdd500496d1ce049ae0b0'),
    ('internal.invoice_transfer_dto(private.invoice_transfers,uuid)',
      'b91dbdd96bec847ddb165d6a663cc7cb', 'de3c7355b17b84d785e06abe80aa8e91'),
    ('internal.retention_commerce(integer)',
      '422a63c6d6fd2be5a1556893a8975d3f', '55051470a07c224838cb58dc45d66406')
  ) v(sig, reviewed, updated)
),
added as (
  select exists(select 1 from pg_attribute a where a.attrelid = 'private.invoice_transfers'::regclass
      and a.attname = 'expired_at' and not a.attisdropped) as column_added,
    to_regprocedure('api.expire_waiting_bank_transfers(integer)') is not null
      and to_regprocedure('api.get_staff_expired_invoice_transfers()') is not null
      and to_regprocedure('api.get_my_invoice_transfer_expiry(text)') is not null as commands_added
),
state as (
  select bool_and(b.body is not distinct from b.reviewed) and not bool_or(a.column_added) as absent,
    bool_and(b.body is not distinct from b.updated) and bool_and(a.column_added) and bool_and(a.commands_added) as applied
  from bodies b cross join added a
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
  from bodies where body is distinct from reviewed and body is distinct from updated
)
select 'summary' as kind,
  'bank transfer expiry: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; waiting: '
    || (select count(*) from private.invoice_transfers t where t.status = 'awaiting_confirmation')
    || '; waiting 14 days or more: '
    || (select count(*) from private.invoice_transfers t where t.status = 'awaiting_confirmation'
        and t.recorded_at <= statement_timestamp() - interval '14 days')
    || '; expired: '
    || (select count(*) from private.invoice_transfers t where t.status = 'expired') as detail
from state s
union all
select kind, detail from problems;
