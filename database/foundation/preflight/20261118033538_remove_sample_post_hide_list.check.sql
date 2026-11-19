-- Read-only preflight for updates/20261118033538_remove_sample_post_hide_list.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the hide-list table and its four functions are all
-- present (update not applied, with the number of hidden samples the update
-- deletes), all absent (already applied) or partly present (unexpected state).
do $$begin
  set transaction read only;
end$$;
with objects as (
  select v.name, v.present
  from (values
    ('private.hidden_sample_posts', to_regclass('private.hidden_sample_posts') is not null),
    ('internal.set_sample_post_hidden(text,boolean)',
      to_regprocedure('internal.set_sample_post_hidden(text,boolean)') is not null),
    ('api.set_sample_post_hidden(text,boolean)',
      to_regprocedure('api.set_sample_post_hidden(text,boolean)') is not null),
    ('internal.get_hidden_sample_posts()',
      to_regprocedure('internal.get_hidden_sample_posts()') is not null),
    ('api.get_hidden_sample_posts()', to_regprocedure('api.get_hidden_sample_posts()') is not null)
  ) v(name, present)
),
state as (
  select bool_and(present) as not_applied, bool_and(not present) as applied from objects
),
problems as (
  select 'problem' as kind,
    name || ' is ' || case when present then 'present' else 'missing' end
      || ' while other parts of the hide-list are not; do not apply the update' as detail
  from objects, state
  where not state.not_applied and not state.applied
)
select 'summary' as kind,
  'remove sample post hide list: '
    || case when s.applied then 'already applied'
         when s.not_applied then 'update not applied; hidden samples: '
           -- Read by name at run time: the table no longer exists afterwards.
           || (xpath('/row/n/text()', query_to_xml(
                'select count(*) as n from private.hidden_sample_posts', false, true, '')))[1]::text
         else 'unexpected state' end as detail
from state s
union all
select kind, detail from problems;
