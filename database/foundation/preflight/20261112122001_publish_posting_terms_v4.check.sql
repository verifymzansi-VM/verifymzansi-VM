-- Read-only preflight for updates/20261112122001_publish_posting_terms_v4.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary gives the current posting terms version (it must stay posting-v3:
-- the update publishes posting-v4 without making it current), whether
-- posting-v4 is already published, and how many accounts have accepted the
-- current version and posting-v4 (always 0 before posting-v4 is current).
do $$begin
  set transaction read only;
end$$;
with state as (
  select
    (select c.version from private.posting_terms_current c where c.singleton) as current_version,
    (select v.document_hash from private.posting_terms_versions v where v.version='posting-v4') as v4_hash
),
problems as (
  select 'problem' as kind, 'current posting terms are '||coalesce(current_version,'missing')||', expected posting-v3' as detail
    from state where current_version is null or current_version not in('posting-v3','posting-v4')
  union all
  select 'problem', 'posting-v4 is already published with a different document'
    from state where v4_hash is not null and v4_hash<>'ztKvrCyqPz9iQdII2hKLPMklhZey7FCilmj73EfFruc'
)
select 'summary' as kind,
  'current '||coalesce(s.current_version,'missing')
    ||'; accounts that accepted it: '||(select count(*) from private.posting_terms_acceptances a where a.version=s.current_version)
    ||'; posting-v4 '||case when s.v4_hash is null then 'not published (update not applied)'
      when s.v4_hash='ztKvrCyqPz9iQdII2hKLPMklhZey7FCilmj73EfFruc' then 'published (update already applied)'
      else 'published with a different document' end
    ||'; accounts that accepted posting-v4: '||(select count(*) from private.posting_terms_acceptances a where a.version='posting-v4') as detail
from state s
union all
select kind, detail from problems;
