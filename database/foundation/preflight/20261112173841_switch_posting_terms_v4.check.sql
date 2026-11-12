-- Read-only preflight for updates/20261112173841_switch_posting_terms_v4.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary gives the current posting terms version, whether posting-v4 is
-- published, how many plan versions are on sale now (the update takes them all
-- off sale) and how many were taken off sale by the update, and how many plan
-- payments are pending (left alone: if paid they settle as before).
do $$begin
  set transaction read only;
end$$;
with state as (
  select
    (select c.version from private.posting_terms_current c where c.singleton) as current_version,
    (select v.document_hash from private.posting_terms_versions v where v.version='posting-v4') as v4_hash,
    (select count(*) from private.plan_versions v where v.is_public and v.retired_at is null) as on_sale,
    (select count(*) from private.payments p where p.product_kind='plan' and p.status='pending') as pending
),
paused as (
  select coalesce((select (xpath('/row/n/text()',
      query_to_xml('select count(*) as n from private.plan_sale_pauses',false,true,'')))[1]::text::integer
    where to_regclass('private.plan_sale_pauses') is not null),0) as n
),
problems as (
  select 'problem' as kind, 'current posting terms are '||coalesce(current_version,'missing')||', expected posting-v3' as detail
    from state where current_version is null or current_version not in('posting-v3','posting-v4')
  union all
  select 'problem', 'posting-v4 is '||case when v4_hash is null then 'not published: apply 20261112122001_publish_posting_terms_v4.sql first'
      else 'published with a different document' end
    from state where v4_hash is distinct from 'HnObmeyoZjiuPQSF0z0aUgs_t_st87EUjVQGjDahozg'
)
select 'summary' as kind,
  'current '||coalesce(s.current_version,'missing')
    ||case when s.current_version='posting-v4' then ' (update already applied)' else ' (update not applied)' end
    ||'; plans on sale: '||s.on_sale
    ||'; plans taken off sale by the update: '||p.n
    ||'; pending plan payments: '||s.pending as detail
from state s cross join paused p
union all
select kind, detail from problems;
