-- Sign-up mode held in the database, and member invitations kept apart from
-- administrator invitations.
--
-- Until now the sign-up hook (internal.acceptance_signup_guard) admitted only
-- addresses on private.owner_admin_invitations, and an address on that list
-- becomes an administrator once its account enrols an authenticator app
-- (internal.claim_owner_admin_invitation). Inviting an ordinary member
-- therefore meant putting them on the administrator list. This update:
--
-- 1. Adds private.signup_settings, one row: the sign-up mode, 'invite_only'
--    (the default, and what the hook assumes when the row is missing) or
--    'open'. Row level security on; the Auth service role may read the mode
--    (the hook runs as that role), no API role has any access. Updates are
--    refused unless they come from internal.set_signup_mode (trigger
--    signup_settings_guard); deletes and truncation are always refused.
-- 2. Adds the append-only table private.signup_mode_events: one row per mode
--    change (from, to, the administrator account named for it, a written
--    reason, the time). Row level security on, no API role has access;
--    updates, deletes and truncation are refused (internal.append_only_guard).
-- 3. Adds internal.set_signup_mode(p_mode, p_reason, p_changed_by_email),
--    which only the database owner can run: execute is revoked from public
--    and granted to no API role, so no website, browser or staff session can
--    reach it; the owner runs it in the Supabase SQL editor, exactly like
--    internal.bootstrap_first_administrator and internal.grant_house_slots.
--    It refuses (22023 signup_mode_invalid) a mode other than 'invite_only'
--    or 'open', (22023 signup_mode_reason_required) a reason that is not 5 to
--    500 characters of plain text, and (42501 signup_mode_changer_invalid)
--    unless p_changed_by_email names a confirmed, active account with an
--    active admin role and a verified authenticator app, whose id is
--    recorded with the change. Setting the current mode again changes and
--    records nothing. Returns {"mode", "changed"}.
-- 4. Adds api.get_signup_mode() (anon and authenticated): {"mode"} only, so
--    the website can say whether sign-up is by invitation. It is what the
--    website's registration page already tells everyone.
-- 5. Adds private.member_invitations: one row per invited address (lower
--    case), who invited it (a staff account, or none when the database owner
--    added it in the SQL editor), when, until when it admits a sign-up (30
--    days; inviting again restarts the 30 days) and whether it was revoked.
--    Row level security on; the Auth service role may read the address,
--    expiry and revocation (for the hook), no API role has table access. A
--    member invitation never grants any staff role: nothing reads it except
--    the hook and the three commands below.
-- 6. Adds three staff commands (authenticated), each through
--    internal.staff_actor('member:invite'), a new capability held by the
--    admin role only (12-hour authenticator rule, no 15-minute rule):
--    - api.invite_member(p_email): adds or renews an invitation; refuses
--      (22023 member_invitation_email_invalid) an address that is not 3 to
--      254 characters of the form name@domain.tld, and (54000
--      member_invitation_limit) a staff member's 201st invitation in 24
--      hours. Returns {"email", "invited_at", "expires_at"}.
--    - api.revoke_member_invitation(p_email): revokes an open invitation;
--      idempotent. Returns {"email", "revoked"} (false when there was none).
--    - api.list_member_invitations(): the latest 500 invitations with their
--      status ('open', 'expired' or 'revoked') and whether an account with
--      that address exists; never who invited.
-- 7. Adds private.signup_blocked_domains: email domains refused while sign-up
--    is open (a domain refuses its subdomains too), seeded with a short list
--    of well-known disposable-address services. The owner adds or removes
--    rows in the SQL editor. The Auth service role may read the domain.
-- 8. Replaces internal.acceptance_signup_guard (full body below; checked
--    against its reviewed body). Same refusal text "Registration is not open
--    yet" (the website matches it) and same invoker rights. It admits an
--    address with an unrevoked administrator invitation (as before) or an
--    unrevoked, unexpired member invitation, in either mode. Otherwise, in
--    'invite_only' mode it refuses as before; in 'open' mode it admits
--    everyone except an address whose domain is malformed, is an address
--    literal or numeric, ends in a reserved name (test, example, invalid,
--    localhost, local, internal, onion, arpa, lan, home, corp, intranet), is
--    example.com/.net/.org, or is (under) a blocked domain, which gets
--    "Registration is not available for this email address" (403).
-- 9. Replaces internal.run_retention (checked against its reviewed body):
--    also runs internal.purge_member_invitations, which deletes member
--    invitations 30 days after they expired or were revoked ("member
--    invitations": the number deleted). Every other step is unchanged.
--
-- The mode starts as 'invite_only', so nothing changes for visitors when this
-- update is applied: administrator invitations admit and promote exactly as
-- before. No existing row is changed. Opening sign-up (launch, item 60) is one
-- owner SQL editor call:
--   select internal.set_signup_mode('open', '<reason>', '<owner admin email>');
-- with the hosted "Before user created" hook left switched on (it now admits
-- everyone in 'open' mode); switching the hook off would also drop the domain
-- check.
--
-- ORDER: apply first, then merge (the website release reads
-- api.get_signup_mode and falls back to FOUNDATION_REGISTRATION_INVITE_ONLY
-- when it cannot, so either order is safe). After
-- 20261119172135_post_views_and_likes.sql in filename order. Read-only
-- preflight: ../preflight/20261120040242_signup_mode_member_invitations.check.sql.
-- Rollback: ../rollback/20261120040242_signup_mode_member_invitations.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does, and the
-- two functions it replaces have their reviewed bodies (or this update's).
do $$
declare present integer; shape text;
begin
  select (to_regclass('private.signup_settings') is not null)::integer
    + (to_regclass('private.signup_mode_events') is not null)::integer
    + (to_regclass('private.member_invitations') is not null)::integer
    + (to_regclass('private.signup_blocked_domains') is not null)::integer
    + (to_regprocedure('internal.signup_settings_guard()') is not null)::integer
    + (to_regprocedure('internal.set_signup_mode(text,text,text)') is not null)::integer
    + (to_regprocedure('internal.get_signup_mode()') is not null)::integer
    + (to_regprocedure('api.get_signup_mode()') is not null)::integer
    + (to_regprocedure('internal.invite_member(text)') is not null)::integer
    + (to_regprocedure('api.invite_member(text)') is not null)::integer
    + (to_regprocedure('internal.revoke_member_invitation(text)') is not null)::integer
    + (to_regprocedure('api.revoke_member_invitation(text)') is not null)::integer
    + (to_regprocedure('internal.list_member_invitations()') is not null)::integer
    + (to_regprocedure('api.list_member_invitations()') is not null)::integer
    + (to_regprocedure('internal.purge_member_invitations(integer)') is not null)::integer
  into present;
  if present not in (0, 15) then
    raise exception 'signup mode precondition: % of 15 objects exist', present
      using errcode='55000';
  end if;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
        where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.acceptance_signup_guard(jsonb)'), ('internal.run_retention(integer)')) v(sig)
  loop
    if shape not in (
        'internal.acceptance_signup_guard(jsonb) 6afecd39f7374ea9f67f2c39d56d3c9b',
        'internal.acceptance_signup_guard(jsonb) 0dd79427b2bd0772a041efeadef893d0',
        'internal.run_retention(integer) 06a3fbfcb5b2d53e2487719174a62cc5',
        'internal.run_retention(integer) 95dda89b3f540a74110a0ca1eba02e66') then
      raise exception 'signup mode precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
end$$;

-- 1. The sign-up mode.
create table if not exists private.signup_settings (
  id boolean not null default true,
  mode text not null default 'invite_only',
  changed_at timestamptz not null default statement_timestamp(),
  constraint signup_settings_pkey primary key (id),
  constraint signup_settings_one_check check (id),
  constraint signup_settings_mode_check check (mode in ('invite_only', 'open'))
);
alter table private.signup_settings owner to postgres;
alter table private.signup_settings enable row level security;
revoke all on private.signup_settings from public, anon, authenticated, service_role;
insert into private.signup_settings(id, mode) values (true, 'invite_only') on conflict (id) do nothing;

CREATE OR REPLACE FUNCTION internal.signup_settings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'UPDATE' and current_setting('vm.signup_mode', true) = 'on' then return new; end if;
  raise exception 'the sign-up mode changes only through internal.set_signup_mode'
    using errcode = '42501';
end;
$function$;
alter function internal.signup_settings_guard() owner to postgres;
revoke all on function internal.signup_settings_guard() from public, anon, authenticated, service_role;

drop trigger if exists signup_settings_guard on private.signup_settings;
create trigger signup_settings_guard before delete or update on private.signup_settings
  for each row execute function internal.signup_settings_guard();
drop trigger if exists signup_settings_no_truncate on private.signup_settings;
create trigger signup_settings_no_truncate before truncate on private.signup_settings
  for each statement execute function internal.signup_settings_guard();

-- 2. The record of every change.
create table if not exists private.signup_mode_events (
  id uuid not null default gen_random_uuid(),
  from_mode text not null,
  to_mode text not null,
  changed_by uuid not null,
  reason text not null,
  changed_at timestamptz not null default statement_timestamp(),
  constraint signup_mode_events_pkey primary key (id),
  constraint signup_mode_events_from_mode_check check (from_mode in ('invite_only', 'open')),
  constraint signup_mode_events_to_mode_check check (to_mode in ('invite_only', 'open')),
  constraint signup_mode_events_change_check check (from_mode <> to_mode),
  constraint signup_mode_events_reason_check check (char_length(reason) between 5 and 500),
  constraint signup_mode_events_changed_by_fkey foreign key (changed_by)
    references auth.users(id) on delete restrict
);
alter table private.signup_mode_events owner to postgres;
alter table private.signup_mode_events enable row level security;
revoke all on private.signup_mode_events from public, anon, authenticated, service_role;
create index if not exists signup_mode_events_changed_by_idx
  on private.signup_mode_events using btree (changed_by);
drop trigger if exists signup_mode_events_append_only on private.signup_mode_events;
create trigger signup_mode_events_append_only before delete or update on private.signup_mode_events
  for each row execute function internal.append_only_guard();
drop trigger if exists signup_mode_events_no_truncate on private.signup_mode_events;
create trigger signup_mode_events_no_truncate before truncate on private.signup_mode_events
  for each statement execute function internal.append_only_guard();

-- 3. Changing the mode: the database owner only (SQL editor).
CREATE OR REPLACE FUNCTION internal.set_signup_mode(p_mode text, p_reason text, p_changed_by_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  clean_reason text := btrim(p_reason);
  changer uuid;
  current_mode text;
begin
  if p_mode is null or p_mode not in ('invite_only', 'open') then
    raise exception 'signup_mode_invalid' using errcode = '22023';
  end if;
  if clean_reason is null or char_length(clean_reason) not between 5 and 500
    or clean_reason ~ '[[:cntrl:]]' then
    raise exception 'signup_mode_reason_required' using errcode = '22023';
  end if;
  select u.id into changer from auth.users u
  where p_changed_by_email is not null and u.email = lower(btrim(p_changed_by_email))
    and u.email_confirmed_at is not null and u.is_anonymous is false and u.deleted_at is null
    and exists (select 1 from private.current_account_access a where a.id = u.id)
    and exists (select 1 from private.staff_roles r
      where r.user_id = u.id and r.role = 'admin' and r.revoked_at is null)
    and exists (select 1 from auth.mfa_factors f
      where f.user_id = u.id and f.factor_type = 'totp' and f.status = 'verified');
  if changer is null then
    raise exception 'signup_mode_changer_invalid' using errcode = '42501';
  end if;
  select s.mode into current_mode from private.signup_settings s where s.id for update;
  if not found then
    raise exception 'signup_mode_settings_missing' using errcode = '55000';
  end if;
  if current_mode = p_mode then
    return jsonb_build_object('mode', p_mode, 'changed', false);
  end if;
  perform set_config('vm.signup_mode', 'on', true);
  update private.signup_settings s set mode = p_mode, changed_at = statement_timestamp() where s.id;
  perform set_config('vm.signup_mode', '', true);
  insert into private.signup_mode_events(from_mode, to_mode, changed_by, reason)
    values (current_mode, p_mode, changer, clean_reason);
  return jsonb_build_object('mode', p_mode, 'changed', true);
end;
$function$;
alter function internal.set_signup_mode(text,text,text) owner to postgres;
revoke all on function internal.set_signup_mode(text,text,text) from public, anon, authenticated, service_role;

-- 4. Reading the mode (public: the registration page says it anyway).
CREATE OR REPLACE FUNCTION internal.get_signup_mode()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('mode',
    coalesce((select s.mode from private.signup_settings s where s.id), 'invite_only'));
$function$;
alter function internal.get_signup_mode() owner to postgres;
revoke all on function internal.get_signup_mode() from public, anon, authenticated, service_role;
grant execute on function internal.get_signup_mode() to anon;
grant execute on function internal.get_signup_mode() to authenticated;

CREATE OR REPLACE FUNCTION api.get_signup_mode()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_signup_mode();
$function$;
alter function api.get_signup_mode() owner to postgres;
revoke all on function api.get_signup_mode() from public, anon, authenticated, service_role;
grant execute on function api.get_signup_mode() to anon;
grant execute on function api.get_signup_mode() to authenticated;

-- 5. Member invitations.
create table if not exists private.member_invitations (
  email text not null,
  invited_by uuid,
  invited_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '30 days',
  revoked_by uuid,
  revoked_at timestamptz,
  constraint member_invitations_pkey primary key (email),
  constraint member_invitations_email_check check (email = lower(btrim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+[.][^@[:space:][:cntrl:]]+$'),
  constraint member_invitations_expiry_check check (expires_at > invited_at),
  constraint member_invitations_revoked_check check (revoked_by is null or revoked_at is not null),
  constraint member_invitations_invited_by_fkey foreign key (invited_by)
    references auth.users(id) on delete set null,
  constraint member_invitations_revoked_by_fkey foreign key (revoked_by)
    references auth.users(id) on delete set null
);
alter table private.member_invitations owner to postgres;
alter table private.member_invitations enable row level security;
revoke all on private.member_invitations from public, anon, authenticated, service_role;
create index if not exists member_invitations_invited_by_idx
  on private.member_invitations using btree (invited_by, invited_at) where invited_by is not null;
create index if not exists member_invitations_revoked_by_idx
  on private.member_invitations using btree (revoked_by) where revoked_by is not null;
create index if not exists member_invitations_invited_at_idx
  on private.member_invitations using btree (invited_at);

-- 6. Staff commands (admin role, capability member:invite).
insert into private.staff_capabilities(role, capability, requires_recent_mfa)
  values ('admin', 'member:invite', false)
  on conflict (role, capability) do nothing;

CREATE OR REPLACE FUNCTION internal.invite_member(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('member:invite');
  clean text := lower(btrim(p_email));
  recent integer;
  entry private.member_invitations;
begin
  if clean is null or char_length(clean) not between 3 and 254
    or clean !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+[.][^@[:space:][:cntrl:]]+$' then
    raise exception 'member_invitation_email_invalid' using errcode = '22023';
  end if;
  -- One invitation at a time per staff member, so the daily limit holds.
  perform pg_advisory_xact_lock(hashtext('private.member_invitations:' || actor::text));
  select count(*) into recent from private.member_invitations m
  where m.invited_by = actor and m.invited_at > statement_timestamp() - interval '24 hours';
  if recent >= 200 then
    raise exception 'member_invitation_limit' using errcode = '54000';
  end if;
  insert into private.member_invitations as m (email, invited_by)
    values (clean, actor)
    on conflict (email) do update set invited_by = excluded.invited_by,
      invited_at = statement_timestamp(), expires_at = statement_timestamp() + interval '30 days',
      revoked_by = null, revoked_at = null
    returning m.* into entry;
  return jsonb_build_object('email', entry.email, 'invited_at', entry.invited_at,
    'expires_at', entry.expires_at);
end;
$function$;
alter function internal.invite_member(text) owner to postgres;
revoke all on function internal.invite_member(text) from public, anon, authenticated, service_role;
grant execute on function internal.invite_member(text) to authenticated;

CREATE OR REPLACE FUNCTION api.invite_member(p_email text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.invite_member(p_email);
$function$;
alter function api.invite_member(text) owner to postgres;
revoke all on function api.invite_member(text) from public, anon, authenticated, service_role;
grant execute on function api.invite_member(text) to authenticated;

CREATE OR REPLACE FUNCTION internal.revoke_member_invitation(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('member:invite');
  clean text := lower(btrim(p_email));
begin
  if clean is null or char_length(clean) not between 3 and 254 then
    raise exception 'member_invitation_email_invalid' using errcode = '22023';
  end if;
  update private.member_invitations m set revoked_by = actor, revoked_at = statement_timestamp()
  where m.email = clean and m.revoked_at is null;
  return jsonb_build_object('email', clean, 'revoked', found);
end;
$function$;
alter function internal.revoke_member_invitation(text) owner to postgres;
revoke all on function internal.revoke_member_invitation(text) from public, anon, authenticated, service_role;
grant execute on function internal.revoke_member_invitation(text) to authenticated;

CREATE OR REPLACE FUNCTION api.revoke_member_invitation(p_email text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.revoke_member_invitation(p_email);
$function$;
alter function api.revoke_member_invitation(text) owner to postgres;
revoke all on function api.revoke_member_invitation(text) from public, anon, authenticated, service_role;
grant execute on function api.revoke_member_invitation(text) to authenticated;

CREATE OR REPLACE FUNCTION internal.list_member_invitations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.staff_actor('member:invite');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'email', m.email,
        'invited_at', m.invited_at,
        'expires_at', m.expires_at,
        'revoked_at', m.revoked_at,
        'status', case when m.revoked_at is not null then 'revoked'
          when m.expires_at <= statement_timestamp() then 'expired' else 'open' end,
        'registered', exists (select 1 from auth.users u
          where u.email = m.email and u.deleted_at is null))
      order by m.invited_at desc, m.email)
    from (select * from private.member_invitations
      order by invited_at desc, email limit 500) m), '[]'::jsonb));
end;
$function$;
alter function internal.list_member_invitations() owner to postgres;
revoke all on function internal.list_member_invitations() from public, anon, authenticated, service_role;
grant execute on function internal.list_member_invitations() to authenticated;

CREATE OR REPLACE FUNCTION api.list_member_invitations()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_member_invitations();
$function$;
alter function api.list_member_invitations() owner to postgres;
revoke all on function api.list_member_invitations() from public, anon, authenticated, service_role;
grant execute on function api.list_member_invitations() to authenticated;

-- 7. Blocked email domains (used only while sign-up is open).
create table if not exists private.signup_blocked_domains (
  domain text not null,
  reason text not null default 'disposable',
  added_at timestamptz not null default statement_timestamp(),
  constraint signup_blocked_domains_pkey primary key (domain),
  constraint signup_blocked_domains_domain_check check (char_length(domain) between 3 and 253
    and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  constraint signup_blocked_domains_reason_check check (reason in ('disposable', 'abuse'))
);
alter table private.signup_blocked_domains owner to postgres;
alter table private.signup_blocked_domains enable row level security;
revoke all on private.signup_blocked_domains from public, anon, authenticated, service_role;
insert into private.signup_blocked_domains(domain) values
  ('10minutemail.com'), ('discard.email'), ('dispostable.com'), ('fakeinbox.com'),
  ('getnada.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('maildrop.cc'),
  ('mailinator.com'), ('mailnesia.com'), ('sharklasers.com'), ('temp-mail.org'),
  ('throwawaymail.com'), ('trashmail.com'), ('yopmail.com')
  on conflict (domain) do nothing;

-- What the sign-up hook (run as the Auth service role) may read.
grant usage on schema private to supabase_auth_admin;
grant select (id, mode) on private.signup_settings to supabase_auth_admin;
drop policy if exists signup_settings_signup_hook on private.signup_settings;
create policy signup_settings_signup_hook on private.signup_settings
  for select to supabase_auth_admin using (true);
grant select (email, expires_at, revoked_at) on private.member_invitations to supabase_auth_admin;
drop policy if exists member_invitations_signup_hook on private.member_invitations;
create policy member_invitations_signup_hook on private.member_invitations
  for select to supabase_auth_admin using (true);
grant select (domain) on private.signup_blocked_domains to supabase_auth_admin;
drop policy if exists signup_blocked_domains_signup_hook on private.signup_blocked_domains;
create policy signup_blocked_domains_signup_hook on private.signup_blocked_domains
  for select to supabase_auth_admin using (true);

-- 8. The sign-up hook.
CREATE OR REPLACE FUNCTION internal.acceptance_signup_guard(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with applicant as (
    select lower(p_event #>> '{user,email}') as email,
      substring(lower(p_event #>> '{user,email}') from '@([^@]+)$') as domain
    where jsonb_typeof(p_event #> '{user,email}') = 'string'
  )
  select case
    when not exists (select 1 from applicant)
      then '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb
    when exists (select 1 from applicant a join private.owner_admin_invitations i
        on i.email = a.email where i.revoked_at is null)
      or exists (select 1 from applicant a join private.member_invitations m
        on m.email = a.email where m.revoked_at is null and m.expires_at > statement_timestamp())
      then '{}'::jsonb
    when coalesce((select s.mode from private.signup_settings s where s.id), 'invite_only') <> 'open'
      then '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb
    when exists (select 1 from applicant a where a.domain is null
        or a.domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
        or substring(a.domain from '[^.]+$') ~ '^[0-9]+$'
        or substring(a.domain from '[^.]+$') in ('test', 'example', 'invalid', 'localhost', 'local',
          'internal', 'onion', 'arpa', 'lan', 'home', 'corp', 'intranet')
        or a.domain in ('example.com', 'example.net', 'example.org'))
      or exists (select 1 from applicant a join private.signup_blocked_domains b
        on a.domain = b.domain or right(a.domain, char_length(b.domain) + 1) = '.' || b.domain)
      then '{"error":{"http_code":403,"message":"Registration is not available for this email address"}}'::jsonb
    else '{}'::jsonb end;
$function$;
alter function internal.acceptance_signup_guard(jsonb) owner to postgres;
revoke all on function internal.acceptance_signup_guard(jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.acceptance_signup_guard(jsonb) to supabase_auth_admin;

-- 9. Retention.
CREATE OR REPLACE FUNCTION internal.purge_member_invitations(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  delete from private.member_invitations m where m.email in (
    select x.email from private.member_invitations x
    where coalesce(x.revoked_at, x.expires_at) < statement_timestamp() - interval '30 days'
    order by x.invited_at limit p_limit);
  get diagnostics n = row_count;
  return n;
end;
$function$;
alter function internal.purge_member_invitations(integer) owner to postgres;
revoke all on function internal.purge_member_invitations(integer) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit); result:=jsonb_build_object(
    'accounts',internal.run_account_erasures(least(p_limit,20)),
    'privacy_requests',internal.retention_privacy_requests(p_limit),
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit),
    'engagement',internal.purge_post_engagement(),
    'member_invitations',internal.purge_member_invitations(p_limit));
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

notify pgrst,'reload schema';
commit;
