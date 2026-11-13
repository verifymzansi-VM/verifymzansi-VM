-- Read-only preflight for updates/20261113134500_communication_choices_and_signup_terms.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (its 9 functions, 2 tables,
-- the outbox index and the trigger record_signup_terms on auth.users are
-- absent) or applied (every body is the update's and the trigger is on
-- auth.users), names the current Terms version that sign-ups will record, and
-- counts, once applied, the recorded choice changes and sign-up acceptances.
-- A problem row is shown when the member check internal.price_draft_actor()
-- is not the reviewed body (the update needs it), or when only part of the
-- update is present.
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.guard_consent_record()', '867770c2b9c516fdd2b4e18ef6bd200c'),
    ('internal.communication_choices_dto(uuid)', '467064c26e0c111e1968f2fe6f58a649'),
    ('internal.get_my_communication_choices()', '2437caf42b1e564d00c2678310dc3c1c'),
    ('api.get_my_communication_choices()', 'd19281f3b9241ccde77292cee7e7776a'),
    ('internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean)', '62a40e158af34da3ab5cbcaf84753ab3'),
    ('api.save_my_communication_choices(text,boolean,boolean,boolean,boolean)', '837c81b75ddfcf8c8b0042e50b3dcb6f'),
    ('internal.list_my_email_history(integer)', '4438f1596c1cc4e1dc0eca7139e17251'),
    ('api.list_my_email_history(integer)', '00fcc1a073dc0bdbf0b19e6b80e10144'),
    ('internal.record_signup_terms()', '24cf49d6570a6ca066cbde45173a3ed9')
  ) v(sig, after)
),
objects as (
  select count(*) filter (where body = after) as updated,
    count(*) filter (where body is null) as absent,
    count(*) as total
  from added
),
others as (
  select
    (to_regclass('private.communication_choice_events') is not null)::int
      + (to_regclass('private.signup_terms_acceptances') is not null)::int
      + (to_regclass('private.outbox_owner_history_idx') is not null)::int
      + (exists (select 1 from pg_trigger t where t.tgname = 'record_signup_terms'
          and t.tgrelid = 'auth.users'::regclass))::int as present
),
state as (
  select case
    when o.absent = o.total and x.present = 0 then 'update not applied'
    when o.updated = o.total and x.present = 4 then 'already applied'
    else 'unexpected state' end as status
  from objects o, others x
),
problems as (
  select 'problem' as kind,
    'internal.price_draft_actor() is not the reviewed body (md5 '
      || coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
        where p.oid = to_regprocedure('internal.price_draft_actor()')), 'missing')
      || '); do not apply the update' as detail
  where (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure('internal.price_draft_actor()')) is distinct from '1d70271a4447ba5d1377f3f64a6cf029'
  union all
  select 'problem', sig || ' is neither absent nor the update''s body (md5 ' || body || ')'
    from added where body is not null and body <> after
  union all
  select 'problem', 'only part of the update is present'
    from state where status = 'unexpected state'
      and not exists (select 1 from added where body is not null and body <> after)
)
select 'summary' as kind,
  'communication choices and signup terms: ' || s.status
    || '; current terms: ' || coalesce((select c.version from private.posting_terms_current c where c.singleton), 'none')
    -- The two tables exist only once applied, so they are counted through
    -- query_to_xml, which runs only in this branch.
    || case when s.status = 'already applied' then
         '; choice changes recorded: '
           || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.communication_choice_events', false, true, '')))[1]::text
           || '; sign-up acceptances recorded: '
           || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.signup_terms_acceptances', false, true, '')))[1]::text
       else '' end as detail
from state s
union all
select kind, detail from problems;
