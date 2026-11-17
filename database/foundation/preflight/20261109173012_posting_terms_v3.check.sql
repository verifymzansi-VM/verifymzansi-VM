-- Read-only preflight for updates/20261109173012_posting_terms_v3.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update. It is a single query and changes nothing. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary gives the current posting terms version and how many accounts
-- have accepted it: each of them accepts posting-v3 once before their next
-- submission or edit.
with state as (
  select
    (select c.version from private.posting_terms_current c where c.singleton) as current_version,
    (select v.document_hash from private.posting_terms_versions v where v.version='posting-v3') as v3_hash,
    to_regprocedure('internal.ended_post_decision(private.posts)') is not null as expiry_rules_applied
),
problems as (
  select 'problem' as kind, 'apply 20261109104020_post_expiry_rules.sql first' as detail
    from state where not expiry_rules_applied
  union all
  select 'problem', 'current posting terms are '||coalesce(current_version,'missing')||', expected posting-v1'
    from state where current_version is null or current_version not in('posting-v1','posting-v3')
  union all
  select 'problem', 'posting-v3 is already published with a different document'
    from state where v3_hash is not null and v3_hash<>'p2X2YRoaYDOwYDtYhTiFcznVghgyGzRmTJ6BexfhkQE'
)
select 'summary' as kind,
  'current '||coalesce(s.current_version,'missing')
    ||'; accounts that accepted it: '||(select count(*) from private.posting_terms_acceptances a where a.version=s.current_version)
    ||'; posting-v3 already current: '||(s.current_version='posting-v3')::text as detail
from state s
union all
select kind, detail from problems;
