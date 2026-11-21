-- Read-only preflight for updates/20261120191500_privacy_export_confirm.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the functions the update relies on or replaces are
-- their reviewed bodies and none of the update's objects exist (update not
-- applied), or every object is the update's exact definition (already
-- applied): function bodies (md5; internal.signal_owner_inbox unchanged), the new
-- functions' security definer, search path, owner and execute grants, the two
-- columns (name and type), the unique index (unique, valid, pg_get_indexdef)
-- and the export check (pg_get_constraintdef md5). It also refuses while
-- private.notifications has any trigger or rule but its reviewed update guard
-- (the export's bell notice must not be dropped or changed), and while
-- private.privacy_notice_jobs has any trigger or rule (none in the baseline;
-- re-arming an export email relies on the job row as written and on
-- internal.complete_frontend_privacy_notice, whose body it also pins). It
-- counts:
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
    ('internal.signal_owner_inbox(uuid)',
      '2a7742d89598d62117a9b7620e0271e9', '2a7742d89598d62117a9b7620e0271e9'),
    ('internal.complete_frontend_privacy_notice(uuid,uuid,boolean)',
      '6850de7c9de63d0352b4362a14c263d0', '6850de7c9de63d0352b4362a14c263d0'),
    ('internal.export_frontend_privacy_request(uuid,integer)',
      '939737e433fcf800d5e98a3dd1569e5d', '49e4d463e4529a6f9ef9a115fbc0b5e5'),
    ('internal.retention_privacy_requests(integer)',
      'ae00ab54c00fd3f6f64ac6b8061ba929', 'cbb20e00ff20ef8448bd64b79081596e'),
    ('internal.claim_frontend_privacy_notice()',
      'ab583eeac94d2d46cee6344b5e0d6ef6', '98f8a3f23b7509881aa6dfc8b1e7a335'),
    ('internal.privacy_notice_deliverable(private.privacy_requests)', null, '07d09e5b62485aebc0bd4d1b16e04809'),
    ('api.export_frontend_privacy_request(uuid,integer)',
      '251a62d1bb6d474172d02a2867b2556a', '251a62d1bb6d474172d02a2867b2556a'),
    ('internal.prepare_frontend_privacy_export(uuid,integer)', null, 'd00c387a3868a4ed4296001f8c295249'),
    ('api.prepare_frontend_privacy_export(uuid,integer)', null, '001f2fc46398c56fd2ac6d7b3bf2cf11'),
    ('internal.confirm_frontend_privacy_export(uuid,integer,uuid)', null, '3a5235816f71272ad425ced5d87e5af4'),
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
      when 'index privacy_events_export_idx' then (select i.indisunique || ' ' || i.indisvalid || ' ' || pg_get_indexdef(i.indexrelid)
        from pg_index i where i.indexrelid = to_regclass('private.privacy_events_export_idx'))
      when 'check privacy_request_events_export_check' then (select md5(pg_get_constraintdef(c.oid))
        from pg_constraint c where c.conrelid = 'private.privacy_request_events'::regclass
          and c.conname = 'privacy_request_events_export_check')
      else (select p.prosecdef::text || ' ' || p.provolatile::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '') || ' '
          || p.proowner::regrole::text || ' ' || has_function_privilege('anon', p.oid, 'execute')::text || ' '
          || has_function_privilege('authenticated', p.oid, 'execute')::text || ' '
          || has_function_privilege('service_role', p.oid, 'execute')::text
        from pg_proc p where p.oid = to_regprocedure(substr(v.name, 10)))
    end as current
  from (values
    ('column export_id', 'uuid false'),
    ('column export_digest', 'text false'),
    ('index privacy_events_export_idx',
      'true true CREATE UNIQUE INDEX privacy_events_export_idx ON private.privacy_request_events USING btree (export_id, action) WHERE (export_id IS NOT NULL)'),
    ('check privacy_request_events_export_check', 'ad76579f0398a3fa9bfda5d352b54e03'),
    -- Security definer, volatility, search path, owner and execute for anon,
    -- authenticated and service_role.
    ('settings internal.prepare_frontend_privacy_export(uuid,integer)', 'true v search_path=pg_catalog postgres false true false'),
    ('settings api.prepare_frontend_privacy_export(uuid,integer)', 'false v search_path=pg_catalog postgres false true false'),
    ('settings internal.confirm_frontend_privacy_export(uuid,integer,uuid)', 'true v search_path=pg_catalog postgres false true false'),
    ('settings api.confirm_frontend_privacy_export(uuid,integer,uuid)', 'false v search_path=pg_catalog postgres false true false'),
    ('settings internal.privacy_notice_deliverable(private.privacy_requests)', 'false s search_path=pg_catalog postgres false false false')
  ) v(name, updated)
),
actions as (
  select (select array_agg(m[1] order by m[1])::text[] from pg_constraint c,
        regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
      where c.conrelid = 'private.privacy_request_events'::regclass
        and c.conname = 'privacy_request_events_action_check') as current,
    array['assigned','completed','erasure_ordered','exported','extended','identity_verified','recorded',
      'rejected','started','submitted','unassigned']::text[] as reviewed,
    array['assigned','completed','erasure_ordered','export_prepared','export_refused','exported','extended',
      'identity_verified','recorded','rejected','started','submitted','unassigned']::text[] as updated
),
notification_guards as (
  select (select coalesce(string_agg(t.tgenabled::text || ' ' || pg_get_triggerdef(t.oid), ';' order by t.tgname), '')
      from pg_trigger t where t.tgrelid = 'private.notifications'::regclass and not t.tgisinternal)
      = 'O CREATE TRIGGER notification_guard BEFORE UPDATE ON private.notifications FOR EACH ROW EXECUTE FUNCTION internal.notification_guard()'
    and not exists (select 1 from pg_rewrite w where w.ev_class = 'private.notifications'::regclass) as reviewed
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
  select 'problem', 'private.notifications has an unreviewed trigger or rule; do not apply the update'
    from notification_guards g where not g.reviewed
  union all
  select 'problem', 'private.privacy_notice_jobs has a trigger or rule; do not apply the update'
    where exists (select 1 from pg_trigger t where t.tgrelid = 'private.privacy_notice_jobs'::regclass and not t.tgisinternal)
      or exists (select 1 from pg_rewrite w where w.ev_class = 'private.privacy_notice_jobs'::regclass)
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
