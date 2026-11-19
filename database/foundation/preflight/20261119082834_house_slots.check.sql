-- Read-only preflight for updates/20261119082834_house_slots.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and starts "house slots: update not applied".
--
-- The summary says whether the three functions the update adds, its table,
-- index and three triggers are absent and the two functions it replaces
-- (internal.frontend_privacy_export_data, internal.run_post_lifecycle) have
-- their reviewed earlier bodies (update not applied), all present with the
-- update's bodies (already applied), or a mix (unexpected state), and counts:
-- - "admins": accounts with an active admin role;
-- - "ready to receive": of those, confirmed active accounts with an accepted
--   ID review and a verified authenticator app (only they can receive house
--   slots);
-- - "staff-granted slots": current `staff_grant` slots of any kind;
-- - "house slots": current house slots and recorded events ("none (table
--   absent)" before the update).
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.before, v.after,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)), 'absent') as body
  from (values
    ('internal.grant_house_slots(text,integer,integer,text,text)', 'absent', '77527fd29f2348e228441612a842cce2'),
    ('internal.end_house_slot(uuid,text)', 'absent', '29401d1db1447bd6ad4fe372f73fc08f'),
    ('internal.house_slots_on_staff_role_change()', 'absent', '2ddae0e784aebb3c57e31677de530d9c'),
    ('internal.frontend_privacy_export_data(uuid)', '0b4cd3f792ffecf94c329277db4da28e', 'e3842fd91a8d4f6b0bfe4cdc5b3030d9'),
    ('internal.run_post_lifecycle(integer)', 'cb5770e3e71e9e6ed31d1eff3e06e3fc', '9496376abcf65c764efe02d4971bba5e')
  ) v(sig, before, after)
),
others as (
  select v.name,
    case v.kind
      when 'table' then to_regclass(v.name) is not null
      when 'index' then to_regclass(v.name) is not null
      when 'trigger' then exists (select 1 from pg_trigger t where t.tgname = split_part(v.name, ' on ', 1)
        and not t.tgisinternal and t.tgrelid = to_regclass(split_part(v.name, ' on ', 2)))
    end as present
  from (values
    ('table', 'private.house_slot_events'),
    ('index', 'private.entitlements_house_slot_ended_idx'),
    ('trigger', 'house_slot_events_append_only on private.house_slot_events'),
    ('trigger', 'house_slot_events_no_truncate on private.house_slot_events'),
    ('trigger', 'staff_roles_end_house_slots on private.staff_roles')
  ) v(kind, name)
),
state as (
  select
    (select count(*) from added where body = before) + (select count(*) from others where not present) as absent,
    (select count(*) from added where body = after) + (select count(*) from others where present) as updated,
    (select count(*) from added) + (select count(*) from others) as total
),
admins as (
  select r.user_id from private.staff_roles r where r.role = 'admin' and r.revoked_at is null
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
    from added where body <> before and body <> after
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from added where body <> before and body <> after)
)
select 'summary' as kind,
  'house slots: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied'
         else 'unexpected state' end
    || '; admins: ' || (select count(*) from admins)
    || '; ready to receive: '
    || (select count(*) from admins a
        where exists (select 1 from private.current_account_access x where x.id = a.user_id)
          and internal.current_verified_identity(a.user_id) is not null
          and exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.factor_type = 'totp'
            and f.status = 'verified'))
    || '; staff-granted slots: '
    || (select count(*) from private.entitlements e where e.source = 'staff_grant' and e.status = 'active'
        and e.ends_at > statement_timestamp())
    || '; house slots: '
    || case when to_regclass('private.house_slot_events') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.entitlements e where e.source = ''staff_grant'' and e.status = ''active''
                and e.ends_at > statement_timestamp()
                and exists (select 1 from private.house_slot_events h where h.entitlement_id = e.id)',
             false, true, '')))[1]::text
           || ' (events: '
           || (xpath('/row/n/text()', query_to_xml('select count(*) as n from private.house_slot_events',
             false, true, '')))[1]::text
           || ')' end as detail
from state s
union all
select kind, detail from problems;
