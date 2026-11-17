-- Read-only preflight for updates/20261117082021_switch_posting_terms_v5.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result is one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "current posting-v4 (update not applied);
-- posting-v5 published", and only after the website release that contains
-- posting-v5 is deployed.
do $$begin
  set transaction read only;
end$$;
with t as (
  select (select c.version from private.posting_terms_current c where c.singleton) as current_version,
    (select v.document_hash from private.posting_terms_versions v where v.version = 'posting-v5') as v5_hash
)
select 'summary' as kind,
  'current ' || coalesce(t.current_version, 'missing')
    || case t.current_version when 'posting-v4' then ' (update not applied)'
         when 'posting-v5' then ' (update already applied)' else ' (unexpected)' end
    || '; posting-v5 ' || case when t.v5_hash is null then 'not published (apply 20261117082020_online_payment_limit.sql first)'
         when t.v5_hash = 'LkgzMkvecZ75fguL1-eUNxwRsHZpg9pi42CTae2Q5mc' then 'published' else 'published with another document' end
    || '; accounts that accepted posting-v5: ' || (select count(*) from private.posting_terms_acceptances a where a.version = 'posting-v5')
    as detail
from t
union all
select 'problem', 'current posting terms are ' || coalesce(t.current_version, 'missing') || ', expected posting-v4 or posting-v5'
from t where t.current_version is null or t.current_version not in ('posting-v4', 'posting-v5')
union all
select 'problem', 'posting-v5 is not published with the reviewed document'
from t where t.v5_hash is distinct from 'LkgzMkvecZ75fguL1-eUNxwRsHZpg9pi42CTae2Q5mc';
