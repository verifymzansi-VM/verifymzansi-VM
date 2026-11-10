-- Read-only preflight for updates/20261109224337_fix_post_command_target.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update. It changes nothing: the first statement makes the transaction read
-- only, so Postgres refuses any write. The result has one "summary" row, then
-- one row per problem. Apply the update only when the summary is the only row.
--
-- The summary says whether internal.consume_frontend_post_command(uuid) is the
-- reviewed live body (the update replaces it) or already the fixed body (the
-- update changes nothing), and how many event edits are staged without a
-- result and have not expired (until the update, saving any of them fails). A
-- member who sends the unchanged form again from the same page before it
-- expires (24 hours after staging) has it saved once the update is applied.
do $$begin
  set transaction read only;
end$$;
with state as (
  select (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
    where p.oid = to_regprocedure('internal.consume_frontend_post_command(uuid)')) as body
),
problems as (
  select 'problem' as kind, 'internal.consume_frontend_post_command(uuid) is missing' as detail
    from state where body is null
  union all
  select 'problem', 'internal.consume_frontend_post_command(uuid) is not the reviewed body (md5 '
      || body || '); do not apply the update'
    from state where body not in ('3a2351c232554b060e0c7dd49bd3c7e3', '48f301b07ef97551cc810c17c4512283')
)
select 'summary' as kind,
  'post command body: '
    || case s.body when '3a2351c232554b060e0c7dd49bd3c7e3' then 'reviewed live body, fix not applied'
         when '48f301b07ef97551cc810c17c4512283' then 'already fixed' else coalesce(s.body, 'missing') end
    || '; unexpired event edits without a result: '
    || (select count(*) from private.frontend_post_commands c
        where c.result is null and c.payload ? 'target_id' and c.payload->'context'->>'kind' = 'event'
          and c.expires_at > clock_timestamp()) as detail
from state s
union all
select kind, detail from problems;
