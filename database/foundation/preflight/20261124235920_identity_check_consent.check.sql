-- Read-only preflight for updates/20261124235920_identity_check_consent.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the start command without the consent argument and
-- the two staff reads have their reviewed bodies and the consent pieces (the
-- start with the argument, two helpers, two columns and a trigger) are absent
-- (update not applied), or everything is the update's (already applied), and
-- counts:
-- - "mode": the automatic ID check setting;
-- - "checks": rows in private.identity_checks, of which "started" are still
--   running (they carry on unchanged; they have no recorded consent);
-- - after the update, "with consent": checks that recorded the consent.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.start_my_identity_check()', '22d86444b8cde7fdafd832f8b91da440', null),
    ('api.start_my_identity_check()', '5b05e790bcb4e799df2b33c3b05b7ef3', null),
    ('internal.get_identity_check_for_case(uuid)', '78f53342647b77ea1d0bc1edcb64261f', '3a84f2d71e895d74ac204535436964bd'),
    ('internal.get_frontend_staff_verification_queue(integer,uuid[])', '9c87b1e5234ba46a5678cf6bb0b4d3c1', '9687e9f224306310699b8efef1df2bfd'),
    ('internal.start_my_identity_check(text)', null, '4f7257c7fb03093617f70dcb6a9ae012'),
    ('api.start_my_identity_check(text)', null, 'f386295ef5231b9eee6d5ae36bed8974'),
    ('internal.identity_check_consent_version()', null, 'b4006d3e91c149d8b0abcd06ab5d93f4'),
    ('internal.identity_check_consent_required()', null, '0297ae02575e99da2dd833ac433b35c5')
  ) v(sig, reviewed, updated)
),
shape as (
  select (select count(*) from pg_attribute a where a.attrelid = 'private.identity_checks'::regclass
        and a.attname in ('consent_version', 'consented_at') and not a.attisdropped)::integer
    + (exists(select 1 from pg_trigger t where t.tgrelid = 'private.identity_checks'::regclass
        and t.tgname = 'identity_check_consent_required'))::integer as present
),
state as (
  select
    count(*) filter (where b.body is not distinct from b.reviewed) as reviewed,
    count(*) filter (where b.body is not distinct from b.updated) as updated,
    count(*) as total,
    (select present from shape) as present
  from bodies b
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body or the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state s
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and not ((s.reviewed = s.total and s.present = 0) or (s.updated = s.total and s.present = 3))
)
select 'summary' as kind,
  'identity check consent: '
    || case when s.updated = s.total and s.present = 3 then 'already applied'
         when s.reviewed = s.total and s.present = 0 then 'update not applied'
         else 'unexpected state' end
    || '; mode: ' || coalesce((select x.mode from private.identity_check_settings x where x.id), 'missing')
    || '; checks: ' || (select count(*) from private.identity_checks)
    || '; started: ' || (select count(*) from private.identity_checks k where k.status = 'started')
    -- The column exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when s.updated = s.total and s.present = 3
         then '; with consent: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.identity_checks where consent_version is not null', false, true, '')))[1]::text
         else '' end as detail
from state s
union all
select kind, detail from problems;
