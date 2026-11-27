-- Read-only preflight for updates/20261127055550_reveal_business_contacts.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied". It reports counts
-- only, never a stored value.
--
-- The summary says whether internal.reveal_post_phone and
-- internal.frontend_post_presentation have their reviewed bodies and
-- internal.business_contact_number is absent (update not applied), or all
-- three have the update's bodies (already applied), and counts, over
-- businesses (Business and Tourism) that are publicly live: those with a
-- phone number, those with a WhatsApp number, and those with a phone or
-- WhatsApp number the update will not serve (not a South African landline,
-- mobile or 087, 0800, 0860 or 0861 number, a WhatsApp number that is not a
-- mobile, or a channel not ticked in the business's contact methods). Empty
-- and null values are not counted.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.reveal_post_phone(uuid,text)', '98baceb9be415a5ba2150793263e58e1', 'a30f22dd9c40c95cdc35abb9dcf5e204'),
    ('internal.frontend_post_presentation(uuid)', '9f279565fc4eca46f6b355313a2271a3', 'c679983dbb6c63714de6be71c459ee85'),
    ('internal.business_contact_number(jsonb,jsonb,text)', null, 'fd668f7973bcc89a2d139ab4e3d24af8')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
numbers as (
  select
    nullif(regexp_replace(coalesce(d.contacts ->> 'phone', ''), '[ ()-]', '', 'g'), '') as phone,
    nullif(regexp_replace(coalesce(d.contacts ->> 'whatsapp', ''), '[ ()-]', '', 'g'), '') as whatsapp,
    case when jsonb_typeof(d.data #> '{category_details,contact_methods}') = 'array'
      then d.data #> '{category_details,contact_methods}' end as methods
  from private.public_eligible_posts e
  join private.posts p on p.id = e.id and p.kind = 'business'
  join private.post_presentations d on d.post_id = p.id
)
select 'summary' as kind,
  'business contacts reveal: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; live businesses with a phone number: ' || (select count(*) from numbers where phone is not null)
    || '; with a WhatsApp number: ' || (select count(*) from numbers where whatsapp is not null)
    || '; with a number not served: ' || (select count(*) from numbers
         where (phone is not null and (phone !~ '^(0|27|[+]27)(([1-5][0-9]|6[0-9]|7[1-46-9]|8[1-47])[0-9]{7}|(800|86[01])[0-9]{6})$'
                 or (methods is not null and not methods ? 'call')))
            or (whatsapp is not null and (whatsapp !~ '^(0|27|[+]27)(6[0-9]|7[1-46-9]|8[1-4])[0-9]{7}$'
                 or (methods is not null and not methods ? 'whatsapp')))) as detail
from state s
union all
select 'problem', sig || ' is not the reviewed body and not the update''s (md5 '
    || coalesce(body, 'missing') || '); do not apply the update'
  from bodies where body is distinct from reviewed and body is distinct from updated;
