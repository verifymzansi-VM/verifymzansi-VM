-- Read-only preflight for updates/20261127055550_reveal_business_contacts.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied". It reports counts
-- only, never a stored value.
--
-- The summary says whether internal.reveal_post_phone has the reviewed body
-- (update not applied) or the update's (already applied), and counts, over
-- businesses (Business and Tourism) that are publicly live: those with a
-- phone number, those with a WhatsApp number, and those with a phone or
-- WhatsApp number the update will not serve (not a South African number, or a
-- WhatsApp number that is not a mobile). Empty and null values are not
-- counted.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.reveal_post_phone(uuid,text)', '98baceb9be415a5ba2150793263e58e1', '3c71cc40436dfcc792ecea4ed0d0db3f')
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
    nullif(regexp_replace(coalesce(d.contacts ->> 'whatsapp', ''), '[ ()-]', '', 'g'), '') as whatsapp
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
         where (phone is not null and phone !~ '^(0|27|[+]27)[1-8][0-9]{8}$')
            or (whatsapp is not null and whatsapp !~ '^(0|27|[+]27)[6-8][0-9]{8}$')) as detail
from state s
union all
select 'problem', sig || ' is not the reviewed body and not the update''s (md5 '
    || coalesce(body, 'missing') || '); do not apply the update'
  from bodies where body is distinct from reviewed and body is distinct from updated;
