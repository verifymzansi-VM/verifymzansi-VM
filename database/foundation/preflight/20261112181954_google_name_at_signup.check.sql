-- Read-only preflight for updates/20261112181954_google_name_at_signup.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row.
--
-- The summary says whether the profile trigger is the reviewed body and the
-- update's helper is absent, or everything is already the update's, and
-- counts:
-- - "profiles without a name": profiles with no display name (no locked
--   legal name can be among them: a lock always comes with its name);
-- - "of which the update names": those of a non-anonymous, not deleted Auth
--   user whose sign-up details hold a name that passes the person name rule
--   (display_name, full_name, name, or given_name and family_name), which the
--   update's one-time fill names. After the update it must read 0.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.create_account_profile()', '3ab0ef1fbe3b0afda15a64bb5526fb8d', '4a0e4e02cbae11e5059e6ee0e89d1046'),
    ('internal.signup_display_name(jsonb)', null, '52cf17d4e33c510c130e588771a9d106')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state where reviewed <> total and updated <> total
      and not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
),
unnamed as (
  select p.account_id, u.id as user_id, u.is_anonymous, u.deleted_at, u.raw_user_meta_data as meta, p.revision
  from private.profiles p
  left join auth.users u on u.id = p.account_id
  where p.display_name is null and p.legal_name_locked_at is null
),
fillable as (
  select n.account_id from unnamed n
  where n.user_id is not null and not n.is_anonymous and n.deleted_at is null and n.revision < 2147483647
    and exists (
      select 1 from (values
        (case when jsonb_typeof(n.meta -> 'display_name') = 'string' then n.meta ->> 'display_name' end),
        (case when jsonb_typeof(n.meta -> 'full_name') = 'string' then n.meta ->> 'full_name' end),
        (case when jsonb_typeof(n.meta -> 'name') = 'string' then n.meta ->> 'name' end),
        (case when jsonb_typeof(n.meta -> 'given_name') = 'string' and jsonb_typeof(n.meta -> 'family_name') = 'string'
            and btrim(n.meta ->> 'given_name') <> '' and btrim(n.meta ->> 'family_name') <> ''
          then btrim(n.meta ->> 'given_name') || ' ' || btrim(n.meta ->> 'family_name') end)
      ) c(name)
      where c.name is not null
        and internal.person_name_valid(normalize(btrim(c.name), NFC))
        and not internal.person_name_reserved(normalize(btrim(c.name), NFC)))
)
select 'summary' as kind,
  'google name at signup: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'reviewed body, update not applied'
         else 'unexpected state' end
    || '; profiles without a name: ' || (select count(*) from unnamed)
    || '; of which the update names: ' || (select count(*) from fillable) as detail
from state s
union all
select kind, detail from problems;
