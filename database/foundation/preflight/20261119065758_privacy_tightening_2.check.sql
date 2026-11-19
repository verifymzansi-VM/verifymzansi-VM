-- Read-only preflight for updates/20261119065758_privacy_tightening_2.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and starts "privacy tightening 2: update not
-- applied".
--
-- The summary says whether the thirteen functions the update replaces have the
-- reviewed earlier bodies and its new helper is absent (update not applied),
-- all have the update's bodies (already applied), or a mix (unexpected
-- state), and counts:
-- - "analytics on" and "third-party sharing on": members whose latest choice
--   turned it on (they keep it; they can still turn it off);
-- - "partners above 20%": must be 0 (each one is also a problem row);
-- - "open ID checks with nothing to review": open ID cases without a current
--   submission, which the staff counters stop counting.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean)',
      '4d5daa0c4ec09f17833326c54dd77f14', '108eb16e62297bf4efe5b7502c3dca31'),
    ('internal.staff_dashboard_overview()',
      'ab15776eedf0a9d7316716ced5edd3d7', '575b368298007e14e2935224362ac0b8'),
    ('internal.restored_staff_queues()',
      'bcdaf1a5329c6d7c850ac13d65b9c907', 'eeabf5112eaca63d3f0285dbb1e54ac8'),
    ('internal.search_posts(jsonb)',
      'bb0f9748bc15c27d76495152bab2eb2a', '47d9d7f5dc22300611d0b07dd3a998f0'),
    ('internal.staff_save_partner(uuid,text,text,integer,text)',
      'f5d4ede86048226adb114a4d2080ca0d', '84211230f68fc91ae0bc3e5545b64ede'),
    ('internal.get_frontend_enforcement()',
      '133f494150ce9998900ea99e2e51435c', 'a712dfc620272856484dc35a253698df'),
    ('internal.get_frontend_partner_admin()',
      'ea9aa86cc1c731f513d67d175baae42c', '0cb0d98d06162be7a9d34fe902127f4f'),
    ('internal.staff_get_organisation(uuid)',
      'ffe628db2b77015e74e140d92f1f48a1', '98da242d11190c87c4c7a79663fad30c'),
    ('internal.get_frontend_staff_organisation_detail(uuid)',
      'f11ffcd74661d45158c30ee4e780e8c3', '7e9eb158699413b43d63d30b86441400'),
    ('internal.get_frontend_cipc_case(uuid)',
      'ed026d48191cac201053305cde485957', 'd6047d65ff244d349a63273a354d162c'),
    ('internal.get_frontend_seen_case(uuid)',
      '1275da13ade5358710b03902b00e7248', 'a1a42c71ed078d188ebe94a2e9ac4bb5'),
    ('internal.authorize_frontend_seen_file(uuid,boolean)',
      '67feeb57c71f894b88f2fc89e133c2c6', '7a51ab618ce14a97309fdb50fd21acea'),
    ('internal.account_closing_actor()',
      '170006872f636cdda2a2bbc3e08a0a43', 'f693dcfec7976a87e42941286d8b2305'),
    ('internal.business_check_reread_open(timestamp with time zone)',
      null, '257483078d7b7b9a21d81fc6680ab2cd')
  ) v(sig, reviewed, updated)
),
state as (
  select bool_and(body is not distinct from reviewed) as absent,
    bool_and(body is not distinct from updated) as applied
  from bodies
),
latest as (
  select distinct on (e.account_id, e.purpose) e.account_id, e.purpose, e.granted
  from private.communication_choice_events e
  where e.purpose in ('analytics', 'third_party_sharing')
  order by e.account_id, e.purpose, e.recorded_at desc, e.id desc
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
  from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'partner ' || p.code || ' has a rate above 20% (' || p.commission_bps || ' basis points); do not apply the update'
  from private.partners p where p.commission_bps > 2000
)
select 'summary' as kind,
  'privacy tightening 2: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; analytics on: '
    || (select count(*) from latest l where l.purpose = 'analytics' and l.granted)
    || '; third-party sharing on: '
    || (select count(*) from latest l where l.purpose = 'third_party_sharing' and l.granted)
    || '; partners above 20%: '
    || (select count(*) from private.partners p where p.commission_bps > 2000)
    || '; open ID checks with nothing to review: '
    || (select count(*) from private.evidence_cases e where e.kind = 'kyc' and e.status = 'open'
        and not exists (select 1 from private.verification_current_submissions v
          join private.verification_identity_submissions x on x.id = v.submission_id and x.case_version = e.version
          where v.case_id = e.id)) as detail
from state s
union all
select kind, detail from problems;
