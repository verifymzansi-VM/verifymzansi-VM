-- Read-only preflight for updates/20261126053701_invoice_pay_link.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether every function the update replaces has its
-- reviewed body, the functions it adds are absent and private.customer_invoices
-- has no pay_link_hash (update not applied), or everything is the update's
-- (already applied), and counts:
-- - "unpaid invoices": issued customer invoices;
-- - after the update, "invoices with a link" (pay_link_hash set) and
--   "invoice emails" (outbox rows of kind invoice_issued).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    case when v.sig = 'private.customer_invoices.pay_link_hash'
      then case when exists(select 1 from pg_attribute a where a.attrelid = 'private.customer_invoices'::regclass
        and a.attname = 'pay_link_hash' and not a.attisdropped) then 'column' end
      else (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig))
    end as body
  from (values
    ('internal.notify_invoice_issued()', '5567380db94629f630d381178b8bc36c', '57575d30894464764cd952b702dc9c62'),
    ('internal.claim_supported_notification_outbox(text[],integer)', '407d5c969a5cf466602555fedb7b23df', '5956225673e82e882b257114e2b7d13a'),
    ('internal.get_payment_receipt(uuid)', '764707a2ed4f9c87985e88b1afcde37c', '0826c70e07ee5239d5bfe9c2a6cd9600'),
    ('api.get_my_invoice(text)', '72559cc96149f8eac3cf52588756259f', 'df0d980d68553a2d987292450f7997cc'),
    ('api.save_my_invoice_billing(text,integer,text,text,text)', '129ad06fc4aff40bb16288ed2447b012', '0f4ebfbb0a3dc8b068803007ec95bca6'),
    ('api.start_invoice_payment(text,bigint,boolean)', 'd1321dd29a058e834bcebc392f293e6e', 'c05e01c01b34d4ae7e319849bd7c1d4d'),
    ('internal.get_my_invoice(text)', 'c09de82e382314eb3b611440efaf589d', null),
    ('internal.save_my_invoice_billing(text,integer,text,text,text)', 'ec1a645a07efe77b5e1611b6ac9f44b3', null),
    ('internal.start_invoice_payment(text,bigint,boolean)', '3637cefdf51809d67891104e041d71da', null),
    ('internal.get_my_invoice(text,text)', null, '9bf1ddcdb3881bbb3d2e2f843da1083d'),
    ('internal.save_my_invoice_billing(text,integer,text,text,text,text)', null, '32a0aa61c578ecd64030a83b4c24976e'),
    ('internal.start_invoice_payment(text,bigint,boolean,text)', null, '17f6fcaae211453eec7ad232adbd92ea'),
    ('internal.customer_invoice_for_caller(text,text)', null, '30668940c8cb3a35997782cd3455ab30'),
    ('internal.prepare_invoice_email(uuid,text)', null, '9c2e40f1b2996022919e8fa136af884d'),
    ('api.prepare_invoice_email(uuid,text)', null, 'ac97f4b15722956f2396463264460943'),
    ('api.get_invoice_by_link(text)', null, '7d4fba24f54575ad7a34bf81c2bd968b'),
    ('api.save_invoice_billing_by_link(text,integer,text,text,text)', null, 'f4ab3a6005a76a6b64d99cf7ca60905f'),
    ('api.start_invoice_payment_by_link(text,bigint,boolean)', null, '8a67bd41ec4b078612902a76d548078b'),
    ('private.customer_invoices.pay_link_hash', null, 'column')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body is not distinct from updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is neither the reviewed body nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and reviewed <> total and updated <> total
)
select 'summary' as kind,
  'invoice payment link: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; unpaid invoices: ' || (select count(*) from private.customer_invoices i where i.status = 'issued')
    -- The column exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when s.updated = s.total
         then '; invoices with a link: ' || (xpath('/row/n/text()', query_to_xml(
           'select count(*) as n from private.customer_invoices where pay_link_hash is not null', false, true, '')))[1]::text
           || '; invoice emails: ' || (select count(*) from private.outbox_events o where o.kind = 'invoice_issued')
         else '' end as detail
from state s
union all
select kind, detail from problems;
