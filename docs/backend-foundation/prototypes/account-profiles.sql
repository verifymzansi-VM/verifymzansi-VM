-- Account profiles. Owner commands edit only the display name, bio, avatar
-- and an unreviewed legal-name claim. Verified names, the name lock, roles,
-- badges, phone and locality are never writable through profile input: the
-- legal name locks only from an accepted identity review, and phone/locality
-- stay canonical verification proofs projected at read time.

-- Defence in depth: hosted Auth already requires email confirmation before
-- sign-in. Account authority also requires a confirmed address, so a later
-- Auth setting change cannot let unconfirmed accounts act.
create or replace view private.current_account_access with (security_invoker=true) as
  select u.id from auth.users u
  where u.is_anonymous is false and u.deleted_at is null
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until<=statement_timestamp())
    and not exists(select 1 from private.account_closures c where c.user_id=u.id)
    and not exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
      where c.subject_id=u.id and d.status='approved' and d.action='restrict_account');
revoke all on private.current_account_access from public,anon,authenticated,service_role;

-- Bio: NFC, trimmed, at most 300 characters. Newlines are allowed; other
-- control, zero-width and bidirectional override characters are refused.
create function internal.profile_bio_valid(p_bio text)
returns boolean language sql immutable parallel safe security invoker set search_path=pg_catalog as $$
  select p_bio is not null and char_length(p_bio) between 1 and 300
    and p_bio is nfc normalized and p_bio=btrim(p_bio,E' \n')
    and p_bio !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]';
$$;
revoke all on function internal.profile_bio_valid(text) from public,anon,authenticated,service_role;

-- Public seller name: first part plus last initial ("Thando D.").
create function internal.profile_public_name(p_display_name text)
returns text language sql immutable parallel safe security invoker set search_path=pg_catalog as $$
  select case when p_display_name is null then null
    when strpos(p_display_name,' ')=0 then p_display_name
    else split_part(p_display_name,' ',1)||' '||left(regexp_replace(p_display_name,'^.* ',''),1)||'.' end;
$$;
revoke all on function internal.profile_public_name(text) from public,anon,authenticated,service_role;

create table private.profiles (
  account_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bio text check(bio is null or internal.profile_bio_valid(bio)),
  legal_first_name text check(legal_first_name is null or internal.person_name_valid(legal_first_name)),
  legal_last_name text check(legal_last_name is null or internal.person_name_valid(legal_last_name)),
  legal_name_locked_at timestamptz,
  legal_name_fact_id uuid,
  avatar_object_id uuid unique references private.media_objects(id) on delete restrict,
  revision integer not null default 1 check(revision between 1 and 2147483647),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check((legal_first_name is null)=(legal_last_name is null)),
  check((legal_name_locked_at is null)=(legal_name_fact_id is null)),
  check(legal_name_locked_at is null or legal_first_name is not null),
  -- A locked display name is the reviewed full legal name, which may exceed
  -- the 50-character limit for ordinary display names.
  check(display_name is null or internal.person_name_valid(display_name)
    or (legal_name_locked_at is not null and display_name=legal_first_name||' '||legal_last_name))
);
create index profiles_avatar_idx on private.profiles(avatar_object_id) where avatar_object_id is not null;
alter table private.profiles enable row level security;
revoke all on private.profiles from public,anon,authenticated,service_role;

-- The names a subject claimed when an identity submission was registered.
-- Reviewers compare them with the document; acceptance locks exactly these.
create table private.identity_submission_names (
  submission_id uuid primary key,
  owner_id uuid not null,
  legal_first_name text not null check(internal.person_name_valid(legal_first_name)),
  legal_last_name text not null check(internal.person_name_valid(legal_last_name)),
  foreign key(submission_id,owner_id) references private.verification_identity_submissions(id,owner_id) on delete cascade
);
create index identity_submission_names_owner_idx on private.identity_submission_names(owner_id);
alter table private.identity_submission_names enable row level security;
revoke all on private.identity_submission_names from public,anon,authenticated,service_role;

create function internal.identity_submission_names_immutable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'submitted legal names are immutable' using errcode='23514';
end;
$$;
revoke all on function internal.identity_submission_names_immutable() from public,anon,authenticated,service_role;
create trigger identity_submission_names_immutable before update on private.identity_submission_names
  for each row execute function internal.identity_submission_names_immutable();

-- The legal-name lock is a data invariant, not a caller flag: any locked state
-- must equal the names of an accepted identity fact for the same account.
create function internal.profile_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' then
    if new.account_id<>old.account_id or new.created_at<>old.created_at then
      raise exception 'profile identity is immutable' using errcode='23514'; end if;
    if old.legal_name_locked_at is not null and new.legal_name_locked_at is null then
      raise exception 'verified legal name lock cannot be removed' using errcode='23514'; end if;
    if old.legal_name_locked_at is not null and new.legal_name_fact_id=old.legal_name_fact_id
      and (new.legal_first_name,new.legal_last_name,new.display_name,new.legal_name_locked_at)
        is distinct from (old.legal_first_name,old.legal_last_name,old.display_name,old.legal_name_locked_at) then
      raise exception 'verified legal name is locked' using errcode='23514'; end if;
  end if;
  if new.legal_name_locked_at is not null and (tg_op='INSERT'
    or new.legal_name_fact_id is distinct from old.legal_name_fact_id) then
    if not exists(select 1 from private.accepted_identity_facts f
        join private.identity_submission_names n on n.submission_id=f.submission_id and n.owner_id=f.owner_id
        where f.id=new.legal_name_fact_id and f.owner_id=new.account_id and f.revoked_at is null
          and n.legal_first_name=new.legal_first_name and n.legal_last_name=new.legal_last_name)
      or new.display_name is distinct from new.legal_first_name||' '||new.legal_last_name then
      raise exception 'legal name lock requires accepted identity names' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
revoke all on function internal.profile_guard() from public,anon,authenticated,service_role;
create trigger profile_guard before insert or update on private.profiles
  for each row execute function internal.profile_guard();

-- Signup creates the profile row. The display name in signup metadata is
-- user-supplied, so it is kept only if it passes the same rule as profile
-- edits; it never carries authority.
create function internal.create_account_profile()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare requested text;
begin
  if new.is_anonymous then return new; end if;
  if jsonb_typeof(new.raw_user_meta_data->'display_name')='string' then
    requested:=normalize(btrim(new.raw_user_meta_data->>'display_name'),NFC);
    if not internal.person_name_valid(requested) or internal.person_name_reserved(requested) then
      requested:=null; end if;
  end if;
  insert into private.profiles(account_id,display_name) values(new.id,requested)
    on conflict(account_id) do nothing;
  return new;
end;
$$;
revoke all on function internal.create_account_profile() from public,anon,authenticated,service_role;
create trigger create_account_profile after insert on auth.users
  for each row execute function internal.create_account_profile();

-- Registration snapshots the subject's claimed legal name. No claim, no
-- submission: a reviewed identity always has reviewed names.
create function internal.snapshot_identity_submission_names()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare first_name text; last_name text;
begin
  select p.legal_first_name,p.legal_last_name into first_name,last_name
    from private.profiles p where p.account_id=new.owner_id for share;
  if first_name is null then
    raise exception 'legal name required before identity submission'
      using errcode='PT409',detail='legal_name_required'; end if;
  insert into private.identity_submission_names(submission_id,owner_id,legal_first_name,legal_last_name)
    values(new.id,new.owner_id,first_name,last_name);
  return new;
end;
$$;
revoke all on function internal.snapshot_identity_submission_names() from public,anon,authenticated,service_role;
create trigger snapshot_identity_submission_names after insert on private.verification_identity_submissions
  for each row execute function internal.snapshot_identity_submission_names();

-- Acceptance propagates the reviewed names and locks them (source parity:
-- display name becomes the full legal name; public cards show "Thando D.").
create function internal.lock_reviewed_legal_name()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare first_name text; last_name text;
begin
  -- A fact recorded as already revoked is history, not an acceptance.
  if new.revoked_at is not null then return new; end if;
  select n.legal_first_name,n.legal_last_name into first_name,last_name
    from private.identity_submission_names n where n.submission_id=new.submission_id and n.owner_id=new.owner_id;
  if not found then
    raise exception 'reviewed legal name unavailable' using errcode='PT409',detail='legal_name_required'; end if;
  insert into private.profiles(account_id) values(new.owner_id) on conflict(account_id) do nothing;
  update private.profiles set legal_first_name=first_name,legal_last_name=last_name,
    display_name=first_name||' '||last_name,legal_name_locked_at=clock_timestamp(),legal_name_fact_id=new.id,
    revision=revision+1,updated_at=statement_timestamp()
  where account_id=new.owner_id and revision<2147483647;
  if not found then raise exception 'profile revision exhausted' using errcode='22023'; end if;
  return new;
end;
$$;
revoke all on function internal.lock_reviewed_legal_name() from public,anon,authenticated,service_role;
create trigger lock_reviewed_legal_name after insert on private.accepted_identity_facts
  for each row execute function internal.lock_reviewed_legal_name();

create function internal.owner_profile_dto(p private.profiles)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select jsonb_build_object('display_name',p.display_name,
    'public_name',internal.profile_public_name(p.display_name),'bio',p.bio,
    'avatar_object_id',p.avatar_object_id,'legal_first_name',p.legal_first_name,
    'legal_last_name',p.legal_last_name,'legal_name_locked',p.legal_name_locked_at is not null,
    'identity_verified',exists(select 1 from private.accepted_identity_facts f
      where f.owner_id=p.account_id and f.revoked_at is null),
    'revision',p.revision,'updated_at',p.updated_at);
$$;
revoke all on function internal.owner_profile_dto(private.profiles) from public,anon,authenticated,service_role;

-- Locks the caller's profile row, creating it for accounts made before the
-- signup trigger existed. Authority is rechecked after the wait.
create function internal.lock_owner_profile(p_expected_revision integer)
returns private.profiles language plpgsql security invoker set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); p private.profiles;
begin
  if p_expected_revision is null or p_expected_revision not between 1 and 2147483646 then
    raise exception 'positive expected revision required' using errcode='22023'; end if;
  insert into private.profiles(account_id) values(actor) on conflict(account_id) do nothing;
  select * into p from private.profiles where account_id=actor for update;
  perform internal.price_draft_actor();
  if p.revision<>p_expected_revision then
    raise exception 'profile changed; reload it' using errcode='PT409',detail='profile_changed'; end if;
  return p;
end;
$$;
revoke all on function internal.lock_owner_profile(integer) from public,anon,authenticated,service_role;

create function internal.get_my_profile()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); p private.profiles;
begin
  insert into private.profiles(account_id) values(actor) on conflict(account_id) do nothing;
  select * into p from private.profiles where account_id=actor;
  return internal.owner_profile_dto(p);
end;
$$;
revoke all on function internal.get_my_profile() from public,anon,authenticated,service_role;
grant execute on function internal.get_my_profile() to authenticated;
create function api.get_my_profile()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_my_profile();
$$;
revoke all on function api.get_my_profile() from public,anon,authenticated,service_role;
grant execute on function api.get_my_profile() to authenticated;

-- Display name and bio. A locked display name may be resent unchanged (or
-- omitted with null) but never changed. Unchanged input is a no-op, so an
-- uncertain retry cannot advance the revision twice.
create function internal.save_my_profile(p_expected_revision integer,p_display_name text,p_bio text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p private.profiles; next_name text;
begin
  p:=internal.lock_owner_profile(p_expected_revision);
  if p.legal_name_locked_at is not null then
    if p_display_name is not null and p_display_name is distinct from p.display_name then
      raise exception 'verified name is locked' using errcode='PT409',detail='legal_name_locked'; end if;
    next_name:=p.display_name;
  else
    if not internal.person_name_valid(p_display_name) then
      raise exception 'display name is invalid' using errcode='22023',detail='display_name_invalid'; end if;
    if p_display_name is distinct from p.display_name and internal.person_name_reserved(p_display_name) then
      raise exception 'display name is reserved' using errcode='22023',detail='display_name_reserved'; end if;
    next_name:=p_display_name;
  end if;
  if p_bio is not null and not internal.profile_bio_valid(p_bio) then
    raise exception 'bio is invalid' using errcode='22023',detail='bio_invalid'; end if;
  if (next_name,p_bio) is not distinct from (p.display_name,p.bio) then return internal.owner_profile_dto(p); end if;
  update private.profiles set display_name=next_name,bio=p_bio,revision=revision+1,updated_at=statement_timestamp()
    where account_id=p.account_id returning * into p;
  return internal.owner_profile_dto(p);
end;
$$;
revoke all on function internal.save_my_profile(integer,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.save_my_profile(integer,text,text) to authenticated;
create function api.save_my_profile(p_expected_revision integer,p_display_name text default null,p_bio text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_my_profile(p_expected_revision,p_display_name,p_bio);
$$;
revoke all on function api.save_my_profile(integer,text,text) from public,anon,authenticated,service_role;
grant execute on function api.save_my_profile(integer,text,text) to authenticated;

-- Unreviewed legal-name claim, used by the next identity submission. Locked
-- once a reviewer accepts an identity.
create function internal.save_my_legal_name(p_expected_revision integer,p_first_name text,p_last_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p private.profiles;
begin
  p:=internal.lock_owner_profile(p_expected_revision);
  if p.legal_name_locked_at is not null then
    raise exception 'verified name is locked' using errcode='PT409',detail='legal_name_locked'; end if;
  if not internal.person_name_valid(p_first_name) or not internal.person_name_valid(p_last_name) then
    raise exception 'legal name is invalid' using errcode='22023',detail='legal_name_invalid'; end if;
  if (p_first_name,p_last_name) is not distinct from (p.legal_first_name,p.legal_last_name) then
    return internal.owner_profile_dto(p); end if;
  update private.profiles set legal_first_name=p_first_name,legal_last_name=p_last_name,
    revision=revision+1,updated_at=statement_timestamp()
    where account_id=p.account_id returning * into p;
  return internal.owner_profile_dto(p);
end;
$$;
revoke all on function internal.save_my_legal_name(integer,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.save_my_legal_name(integer,text,text) to authenticated;
create function api.save_my_legal_name(p_expected_revision integer,p_first_name text,p_last_name text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_my_legal_name(p_expected_revision,p_first_name,p_last_name);
$$;
revoke all on function api.save_my_legal_name(integer,text,text) from public,anon,authenticated,service_role;
grant execute on function api.save_my_legal_name(integer,text,text) to authenticated;

-- Avatar: the caller's own ready image. Objects are locked before linking
-- (media cleanup protocol); a replaced avatar starts its 24-hour reuse window.
create function internal.set_my_avatar(p_expected_revision integer,p_object_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p private.profiles;
begin
  p:=internal.lock_owner_profile(p_expected_revision);
  if p_object_id is not distinct from p.avatar_object_id then return internal.owner_profile_dto(p); end if;
  if p_object_id is not null then
    perform 1 from private.media_objects m where m.id=p_object_id and m.owner_id=p.account_id
      and m.kind='image' and m.state='ready' for update;
    if not found then
      raise exception 'your own ready image is required' using errcode='22023',detail='avatar_unavailable'; end if;
  end if;
  if p.avatar_object_id is not null then
    update private.media_objects set unlinked_at=statement_timestamp() where id=p.avatar_object_id;
  end if;
  update private.profiles set avatar_object_id=p_object_id,revision=revision+1,updated_at=statement_timestamp()
    where account_id=p.account_id returning * into p;
  return internal.owner_profile_dto(p);
end;
$$;
revoke all on function internal.set_my_avatar(integer,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.set_my_avatar(integer,uuid) to authenticated;
create function api.set_my_avatar(p_expected_revision integer,p_object_id uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.set_my_avatar(p_expected_revision,p_object_id);
$$;
revoke all on function api.set_my_avatar(integer,uuid) from public,anon,authenticated,service_role;
grant execute on function api.set_my_avatar(integer,uuid) to authenticated;

-- One-time trusted operator bootstrap of the first administrator. No API
-- role can execute it; it runs only in a reviewed owner SQL session. It never
-- reads signup metadata, refuses once any staff role exists, and requires a
-- confirmed, active account that already has a verified authenticator app.
create function internal.bootstrap_first_administrator(p_email text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare target uuid;
begin
  lock table private.staff_roles in share row exclusive mode;
  if exists(select 1 from private.staff_roles) then
    raise exception 'staff roles are already initialised' using errcode='42501'; end if;
  select u.id into target from auth.users u
    where lower(u.email)=lower(btrim(p_email)) and u.email_confirmed_at is not null and u.is_anonymous is false;
  if not found or not exists(select 1 from private.current_account_access a where a.id=target) then
    raise exception 'confirmed active account required' using errcode='42501'; end if;
  if not exists(select 1 from auth.mfa_factors f where f.user_id=target and f.factor_type='totp' and f.status='verified') then
    raise exception 'verified authenticator app required' using errcode='42501'; end if;
  insert into private.staff_roles(user_id,role) values(target,'admin');
  return jsonb_build_object('user_id',target,'role','admin');
end;
$$;
revoke all on function internal.bootstrap_first_administrator(text) from public,anon,authenticated,service_role;
