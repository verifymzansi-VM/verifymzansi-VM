-- Read-only preflight for updates/20261126062428_catalogue_filters_in_database.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.search_posts and
-- internal.search_post_cards have their reviewed bodies (update not applied)
-- or this update's (already applied), and counts the listed organisations,
-- their active affiliations and their running sponsorships (what the new
-- organisation filters can match).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)),
      'absent') as body
  from (values
    ('internal.search_posts(jsonb)',
      '590ffdf23439ddbf6772f70afd199740', '3084bc16bb1a0fe19ed94f19a3e23089'),
    ('internal.search_post_cards(jsonb)',
      '6bb60ea1828671af6f73e785d217c8ba', '4d8eb454d3e5650e8bf9f553ae0c0b50')
  ) v(sig, reviewed, updated)
),
state as (
  select bool_and(body = reviewed) as absent, bool_and(body = updated) as applied from bodies
),
listed as (
  select o.id from private.organisations o where internal.organisation_listed(o)
),
problems as (
  select 'problem' as kind,
    sig || ' is not the reviewed body or the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
)
select 'summary' as kind,
  'catalogue filters: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; listed organisations: ' || (select count(*) from listed)
    || '; active affiliations: '
    || (select count(*) from private.organisation_affiliations f
         where f.status = 'active' and f.organisation_id in (select id from listed))
    || '; running sponsorships: '
    || (select count(*) from private.organisation_sponsorships x
         where x.status = 'active' and x.starts_at <= statement_timestamp() and x.ends_at > statement_timestamp()
           and x.organisation_id in (select id from listed)) as detail
from state s
union all
select kind, detail from problems;
