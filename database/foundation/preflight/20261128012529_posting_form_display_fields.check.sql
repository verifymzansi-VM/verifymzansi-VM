-- Read-only preflight for updates/20261128012529_posting_form_display_fields.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied". It reports counts
-- only, never a stored value.
--
-- The summary says whether internal.public_post_presentation_data has the
-- reviewed body (update not applied) or the update's (already applied), and
-- counts the presentations already holding one of the new display keys and
-- the business posts whose stored Call or WhatsApp number is not the owner's
-- verified number (from the update those reveal the verified number).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.public_post_presentation_data(text,jsonb)', '0edd179a32830a17a051195629ce8497', 'a07fefcadbed5f09ec48986f583008df'),
    ('internal.reveal_post_phone(uuid,text)', 'a30f22dd9c40c95cdc35abb9dcf5e204', '8694f1646d929efbdacd0cb129b1b1bd')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
)
select 'summary' as kind,
  'posting form display fields: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; presentations with a new display key: ' || (select count(*) from private.post_presentations d
         where d.data -> 'business_details' ? 'visitor_features'
           or d.data -> 'category_details' ?| array['price_from_cents', 'price_unit', 'sleeps', 'bedrooms', 'beds',
             'bathrooms', 'backup_utilities', 'cancellation_free_days', 'opening_hours']
           or d.data -> 'event_details' ?| array['doors_open', 'refund_policy', 'refund_days', 'ticket_sales', 'gate_payment'])
    || '; business posts whose stored number is not the owner''s verified number: ' || (select count(*)
         from private.post_presentations d join private.posts p on p.id = d.post_id
         left join private.verification_phone_proofs f on f.owner_id = p.owner_id and f.revoked_at is null
         where p.kind = 'business'
           and (internal.business_contact_number(d.data, d.contacts, 'call') is distinct from f.phone
             and internal.business_contact_number(d.data, d.contacts, 'call') is not null
            or internal.business_contact_number(d.data, d.contacts, 'whatsapp') is distinct from f.phone
             and internal.business_contact_number(d.data, d.contacts, 'whatsapp') is not null)) as detail
from state s
union all
select 'problem', sig || ' is not the reviewed body and not the update''s (md5 '
    || coalesce(body, 'missing') || '); do not apply the update'
  from bodies where body is distinct from reviewed and body is distinct from updated;
