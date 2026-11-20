-- Read-only preflight for updates/20261120191500_privacy_export_confirm.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the old export command is the reviewed body and
-- the new commands, column and index are absent (update not applied), or
-- everything is the update's (already applied), and counts:
-- - "exports recorded": 'exported' events (the old command's and confirmed
--   ones);
-- - "export emails waiting": 'exported' email jobs not yet delivered;
-- - after the update, "prepared": 'export_prepared' events, and "confirmed":
--   'exported' events that carry an export id.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.export_frontend_privacy_request(uuid,integer)',
      '939737e433fcf800d5e98a3dd1569e5d', '939737e433fcf800d5e98a3dd1569e5d'),
    ('api.export_frontend_privacy_request(uuid,integer)',
      '251a62d1bb6d474172d02a2867b2556a', '251a62d1bb6d474172d02a2867b2556a'),
    ('internal.prepare_frontend_privacy_export(uuid,integer)', null, 'c4b947da9786fd3cc73657e6f8c6fc24'),
    ('api.prepare_frontend_privacy_export(uuid,integer)', null, '001f2fc46398c56fd2ac6d7b3bf2cf11'),
    ('internal.confirm_frontend_privacy_export(uuid,integer,uuid)', null, '520bd0b42886eb8b1af5cfacfd242b99'),
    ('api.confirm_frontend_privacy_export(uuid,integer,uuid)', null, '438d948a6a90a8fefd9c6bf49df8c99f')
  ) v(sig, reviewed, updated)
),
shape as (
  select exists (select 1 from pg_attribute a where a.attrelid = 'private.privacy_request_events'::regclass
        and a.attname = 'export_id' and not a.attisdropped) as has_column,
    to_regclass('private.privacy_events_export_idx') is not null as has_index,
    exists (select 1 from pg_constraint c where c.conrelid = 'private.privacy_request_events'::regclass
        and c.conname = 'privacy_request_events_export_check') as has_check,
    (select array_agg(m[1] order by m[1])::text[] from pg_constraint c,
        regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
      where c.conrelid = 'private.privacy_request_events'::regclass
        and c.conname = 'privacy_request_events_action_check') as actions
),
lists as (
  select array['assigned','completed','erasure_ordered','exported','extended','identity_verified','recorded',
      'rejected','started','submitted','unassigned']::text[] as reviewed,
    array['assigned','completed','erasure_ordered','export_prepared','exported','extended','identity_verified',
      'recorded','rejected','started','submitted','unassigned']::text[] as updated
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
verdict as (
  select
    s.updated = s.total and sh.has_column and sh.has_index and sh.has_check and sh.actions = l.updated as applied,
    s.reviewed = s.total and not sh.has_column and not sh.has_index and not sh.has_check and sh.actions = l.reviewed as absent
  from state s, shape sh, lists l
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'privacy_request_events_action_check is not the reviewed list; do not apply the update'
    from shape sh, lists l where sh.actions is distinct from l.reviewed and sh.actions is distinct from l.updated
  union all
  select 'problem', 'only part of the update is present'
    from verdict v
    where not v.applied and not v.absent
      and not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
)
select 'summary' as kind,
  'privacy export confirm: '
    || case when v.applied then 'already applied' when v.absent then 'update not applied' else 'unexpected state' end
    || '; exports recorded: ' || (select count(*) from private.privacy_request_events e where e.action = 'exported')
    || '; export emails waiting: ' || (select count(*) from private.privacy_notice_jobs j
         where j.kind = 'exported' and j.delivered_at is null)
    -- The column exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when v.applied
         then '; prepared: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.privacy_request_events e where e.action = ''export_prepared''',
             false, true, '')))[1]::text
           || '; confirmed: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.privacy_request_events e where e.action = ''exported'' and e.export_id is not null',
             false, true, '')))[1]::text
         else '' end as detail
from verdict v
union all
select kind, detail from problems;
