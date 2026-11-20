-- Read-only preflight for updates/20261120191500_privacy_export_confirm.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the old export command is the reviewed body and
-- none of the update's objects exist (update not applied), or every object is
-- the update's exact definition (already applied): the four new functions
-- (body md5), the two columns (name and type), the unique index
-- (pg_get_indexdef) and the export check (pg_get_constraintdef md5). It counts:
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
    ('internal.prepare_frontend_privacy_export(uuid,integer)', null, 'a7a7c1431e6da1c18eda98b7e18245fd'),
    ('api.prepare_frontend_privacy_export(uuid,integer)', null, '001f2fc46398c56fd2ac6d7b3bf2cf11'),
    ('internal.confirm_frontend_privacy_export(uuid,integer,uuid)', null, 'f5fc946f1870f6516592dacf42ce90e1'),
    ('api.confirm_frontend_privacy_export(uuid,integer,uuid)', null, '438d948a6a90a8fefd9c6bf49df8c99f')
  ) v(sig, reviewed, updated)
),
objects as (
  -- Each other object of the update: its current definition (null when
  -- absent) and the update's definition.
  select v.name, v.updated,
    case v.name
      when 'column export_id' then (select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull
        from pg_attribute a where a.attrelid = 'private.privacy_request_events'::regclass
          and a.attname = 'export_id' and not a.attisdropped)
      when 'column export_digest' then (select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull
        from pg_attribute a where a.attrelid = 'private.privacy_request_events'::regclass
          and a.attname = 'export_digest' and not a.attisdropped)
      when 'index privacy_events_export_idx' then (select i.indisunique || ' ' || pg_get_indexdef(i.indexrelid)
        from pg_index i where i.indexrelid = to_regclass('private.privacy_events_export_idx'))
      when 'check privacy_request_events_export_check' then (select md5(pg_get_constraintdef(c.oid))
        from pg_constraint c where c.conrelid = 'private.privacy_request_events'::regclass
          and c.conname = 'privacy_request_events_export_check')
    end as current
  from (values
    ('column export_id', 'uuid false'),
    ('column export_digest', 'text false'),
    ('index privacy_events_export_idx',
      'true CREATE UNIQUE INDEX privacy_events_export_idx ON private.privacy_request_events USING btree (export_id, action) WHERE (export_id IS NOT NULL)'),
    ('check privacy_request_events_export_check', '83e9c28122ad3bd5cc71b593251093c6')
  ) v(name, updated)
),
actions as (
  select (select array_agg(m[1] order by m[1])::text[] from pg_constraint c,
        regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
      where c.conrelid = 'private.privacy_request_events'::regclass
        and c.conname = 'privacy_request_events_action_check') as current,
    array['assigned','completed','erasure_ordered','exported','extended','identity_verified','recorded',
      'rejected','started','submitted','unassigned']::text[] as reviewed,
    array['assigned','completed','erasure_ordered','export_prepared','exported','extended','identity_verified',
      'recorded','rejected','started','submitted','unassigned']::text[] as updated
),
verdict as (
  select
    (select bool_and(body is not distinct from updated) from bodies)
      and (select bool_and(current is not distinct from updated) from objects)
      and a.current = a.updated as applied,
    (select bool_and(body is not distinct from reviewed) from bodies)
      and (select bool_and(current is null) from objects)
      and a.current = a.reviewed as absent
  from actions a
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', name || ' is not the update''s definition (' || current || '); do not apply the update'
    from objects where current is not null and current is distinct from updated
  union all
  select 'problem', 'privacy_request_events_action_check is not the reviewed list; do not apply the update'
    from actions a where a.current is distinct from a.reviewed and a.current is distinct from a.updated
  union all
  select 'problem', 'only part of the update is present'
    from verdict v
    where not v.applied and not v.absent
      and not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and not exists (select 1 from objects where current is not null and current is distinct from updated)
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
