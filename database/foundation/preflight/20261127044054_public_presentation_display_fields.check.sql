-- Read-only preflight for updates/20261127044054_public_presentation_display_fields.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied". It reports counts
-- only, never a stored value.
--
-- The summary says whether internal.frontend_post_presentation has the
-- reviewed body (update not applied) or the update's (already applied), and
-- counts: presentations holding an email (the update removes it; 0 after),
-- Market listings holding a street address, businesses holding an address
-- they chose not to publish, and approval snapshots of the posts holding an
-- email (the update moves those that still match their post).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.frontend_post_presentation(uuid)', 'd57885ae409a1a91b5bc9a71d2a94730', '9f279565fc4eca46f6b355313a2271a3')
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
  'public presentation fields: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; presentations with an email: ' || (select count(*) from private.post_presentations d where d.data ? 'email')
    || '; listings with a street address: ' || (select count(*) from private.post_presentations d
         join private.posts p on p.id = d.post_id where p.kind = 'listing' and d.data ? 'location_address')
    || '; businesses with an unpublished address: ' || (select count(*) from private.post_presentations d
         join private.posts p on p.id = d.post_id where p.kind = 'business'
           and d.data #> '{category_details,customer_access}' is not null
           and d.data #> '{category_details,customer_access,publishAddress}' is distinct from 'true'::jsonb
           and (d.data ?| array['location_address', 'store_number', 'map_directions']
             or d.data -> 'business_details' ?| array['street_address', 'suite_or_unit']))
    || '; approval snapshots of posts with an email: ' || (select count(*) from private.frontend_post_approval_snapshots a
         join private.post_presentations d on d.post_id = a.post_id where d.data ? 'email') as detail
from state s
union all
select 'problem', sig || ' is not the reviewed body and not the update''s (md5 '
    || coalesce(body, 'missing') || '); do not apply the update'
  from bodies where body is distinct from reviewed and body is distinct from updated;
