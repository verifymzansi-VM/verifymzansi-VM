-- Read-only preflight for updates/20261122181738_posting_terms_v6.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result is one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "current posting-v5 (update not applied);
-- posting-v6 not published", and only after the website release that contains
-- posting-v6 is deployed.
do $$begin
  set transaction read only;
end$$;
with t as (
  select (select c.version from private.posting_terms_current c where c.singleton) as current_version,
    (select v.document_hash from private.posting_terms_versions v where v.version = 'posting-v6') as v6_hash,
    to_regprocedure('internal.queue_term_ending_notices(integer)') is not null as notice_applied
)
select 'summary' as kind,
  'current ' || coalesce(t.current_version, 'missing')
    || case t.current_version when 'posting-v5' then ' (update not applied)'
         when 'posting-v6' then ' (update already applied)' else ' (unexpected)' end
    || '; posting-v6 ' || case when t.v6_hash is null then 'not published'
         when t.v6_hash = 'loAwnttBi08l1tpiOaAxtsufqNIdeaQPnXKMma0lhSs' then 'published' else 'published with another document' end
    || '; accounts that accepted posting-v6: ' || (select count(*) from private.posting_terms_acceptances a where a.version = 'posting-v6')
    as detail
from t
union all
select 'problem', 'current posting terms are ' || coalesce(t.current_version, 'missing') || ', expected posting-v5 or posting-v6'
from t where t.current_version is null or t.current_version not in ('posting-v5', 'posting-v6')
union all
select 'problem', 'posting-v6 is published with another document'
from t where t.v6_hash is not null and t.v6_hash <> 'loAwnttBi08l1tpiOaAxtsufqNIdeaQPnXKMma0lhSs'
union all
select 'problem', 'the written notice before a long term ends is not applied (apply 20261122111209_term_ending_notice.sql first)'
from t where not t.notice_applied;
