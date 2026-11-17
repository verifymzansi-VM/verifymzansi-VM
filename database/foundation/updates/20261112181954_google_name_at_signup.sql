-- A member who signs up with Google starts with the name Google gave.
--
-- When an Auth user is created, internal.create_account_profile (the trigger
-- create_account_profile on auth.users) creates the member's profile. Until
-- now it read only the sign-up detail `display_name`, which the website's
-- email sign-up form sends. Google sign-up stores the name as `full_name` and
-- `name` (sometimes also `given_name` and `family_name`), so every Google
-- account started with no display name: its profile page and its public name
-- ("Thando D.") stayed empty until the member typed a name.
--
-- From this update:
-- 1. New internal.signup_display_name(p_meta jsonb): the first of
--    `display_name`, `full_name`, `name`, and `given_name` + ' ' +
--    `family_name` (only when both are non-empty strings) that is a string,
--    and, after btrim and NFC normalisation, passes the person name rule
--    (internal.person_name_valid) and is not a reserved name
--    (internal.person_name_reserved). Otherwise null. Sign-up details are
--    written by the member or the sign-in provider, so they only ever give a
--    display name the member could also have typed: never a legal name, a
--    name lock, a role or a verification. No API role can execute it.
-- 2. internal.create_account_profile (same trigger, grants and owner) uses it.
--    Anonymous users are still skipped and an existing profile is still left
--    as it is.
-- 3. A one-time fill for existing accounts: a profile with no display name
--    and no locked legal name, of a non-anonymous Auth user that is not
--    deleted, gets the helper's name from that user's sign-up details, with
--    the revision raised by one as an ordinary profile save does, so a page
--    holding the earlier revision is refused (stale revision) and reloads.
--    Profiles the helper gives no name stay as they are. Running the update
--    again names nobody twice: a named profile is never touched.
-- No API command changes signature, grant or owner, so websites deployed
-- before and after this update work with it.
--
-- ORDER: any time. Read-only preflight:
-- ../preflight/20261112181954_google_name_at_signup.check.sql.
-- Rollback: ../rollback/20261112181954_google_name_at_signup.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: the profile trigger is the reviewed body (or already this
-- update's), and the helper is absent (or already this update's).
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.create_account_profile()'))
      is null
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.create_account_profile()'))
      not in('3ab0ef1fbe3b0afda15a64bb5526fb8d','4a0e4e02cbae11e5059e6ee0e89d1046') then
    raise exception 'profile trigger drift: internal.create_account_profile is not the reviewed body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.signup_display_name(jsonb)'))
      is distinct from '52cf17d4e33c510c130e588771a9d106'
    and to_regprocedure('internal.signup_display_name(jsonb)') is not null then
    raise exception 'profile trigger drift: internal.signup_display_name exists with another body' using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.signup_display_name(p_meta jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate text;
begin
  -- Sign-up details are user-editable: they may suggest a display name and
  -- nothing else. The first candidate that passes the name rule wins.
  if jsonb_typeof(p_meta) is distinct from 'object' then return null; end if;
  foreach candidate in array array[
    case when jsonb_typeof(p_meta->'display_name')='string' then p_meta->>'display_name' end,
    case when jsonb_typeof(p_meta->'full_name')='string' then p_meta->>'full_name' end,
    case when jsonb_typeof(p_meta->'name')='string' then p_meta->>'name' end,
    case when jsonb_typeof(p_meta->'given_name')='string' and jsonb_typeof(p_meta->'family_name')='string'
        and btrim(p_meta->>'given_name')<>'' and btrim(p_meta->>'family_name')<>''
      then btrim(p_meta->>'given_name')||' '||btrim(p_meta->>'family_name') end]
  loop
    continue when candidate is null;
    candidate:=normalize(btrim(candidate),NFC);
    if internal.person_name_valid(candidate) and not internal.person_name_reserved(candidate) then
      return candidate; end if;
  end loop;
  return null;
end;
$function$;
alter function internal.signup_display_name(jsonb) owner to postgres;
revoke all on function internal.signup_display_name(jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.create_account_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.is_anonymous then return new; end if;
  insert into private.profiles(account_id,display_name)
    values(new.id,internal.signup_display_name(new.raw_user_meta_data))
    on conflict(account_id) do nothing;
  return new;
end;
$function$;
alter function internal.create_account_profile() owner to postgres;
revoke all on function internal.create_account_profile() from public;

-- Existing accounts: name the profiles that have no name yet, as an ordinary
-- profile save would (revision + 1). A locked legal name always comes with its
-- display name, so locked profiles are excluded twice over.
update private.profiles p
  set display_name=n.display_name,revision=p.revision+1,updated_at=statement_timestamp()
  from (select u.id,internal.signup_display_name(u.raw_user_meta_data) as display_name
    from auth.users u where not u.is_anonymous and u.deleted_at is null) n
  where p.account_id=n.id and n.display_name is not null
    and p.display_name is null and p.legal_name_locked_at is null and p.revision<2147483647;
commit;
