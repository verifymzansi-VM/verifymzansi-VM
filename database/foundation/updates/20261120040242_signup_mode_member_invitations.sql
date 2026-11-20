-- Sign-up mode held in the database, and member invitations kept apart from
-- administrator invitations.
--
-- Until now the sign-up hook (internal.acceptance_signup_guard) admitted only
-- addresses on private.owner_admin_invitations, and an address on that list
-- becomes an administrator once its account enrols an authenticator app
-- (internal.claim_owner_admin_invitation). Inviting an ordinary member
-- therefore meant putting them on the administrator list, and an invitation
-- admitted any number of sign-ups (after an email change or an erasure, the
-- same address could sign up again). This update:
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
--    It is kept without a time limit (the record of who opened or closed
--    sign-up); its account key is ON DELETE RESTRICT, like the staff role
--    rows of the same administrators, so account erasure keeps such an
--    administrator's Auth user.
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
--    days; inviting again restarts the 30 days), the account that used it
--    and when (claimed_by, claimed_at) and whether it was revoked. Row level
--    security on; the Auth service role may read the address, expiry, use
--    and revocation (for the hook), no API role has table access. A member
--    invitation never grants any staff role: nothing reads it except the
--    hook, the sign-up trigger and the commands below.
-- 6. Adds the append-only table private.member_invitation_events: one row
--    per invitation, renewal or revocation made with the commands below (the
--    address, the action, the staff account, the time). Row level security
--    on, no API role has access; updates, deletes and truncation are refused
--    except by the retention job (after 12 months) and account erasure.
-- 7. Adds three staff commands (authenticated), each through
--    internal.staff_actor('member:invite'), a new capability held by the
--    admin role only (12-hour authenticator rule, no 15-minute rule):
--    - api.invite_member(p_email): adds an invitation, or renews one (a new
--      30 days; a used invitation becomes unused again); refuses (22023
--      member_invitation_email_invalid) an address that is not 3 to 254
--      characters of the form name@domain.tld, (PT409, detail
--      member_invitation_account_exists, "This person already has an
--      account.") an address that already has an account, and (54000
--      member_invitation_limit) a staff member's 201st invitation or renewal
--      in 24 hours, counted from their own events. Returns {"email",
--      "invited_at", "expires_at"}.
--    - api.revoke_member_invitation(p_email): revokes an open invitation;
--      idempotent. Returns {"email", "revoked"} (false when there was none).
--    - api.list_member_invitations(): the latest 500 invitations with their
--      status ('open', 'used', 'expired' or 'revoked'), when each was used
--      and whether the account that used it still exists; never who
--      invited.
-- 8. Adds private.signup_blocked_domains: email domains refused while sign-up
--    is open (a domain refuses its subdomains too), seeded with a short list
--    of well-known disposable-address services. The owner adds or removes
--    rows in the SQL editor. The Auth service role may read the domain.
--    internal.signup_email_domain_refused(p_email) holds the one domain rule
--    (malformed, an address literal or numeric, a reserved name: test,
--    example, invalid, localhost, local, internal, onion, arpa, lan, home,
--    corp, intranet; example.com/.net/.org; or (under) a blocked domain).
--    api.check_email_domain(p_email) (authenticated) answers {"allowed"}:
--    false only while sign-up is open and the rule refuses the domain; the
--    website's email change uses it.
-- 9. An invitation admits ONE sign-up. Adds signed_up_by and signed_up_at to
--    private.owner_admin_invitations (the account created with the
--    invitation), filled now for invitations whose address already has an
--    account, and the trigger claim_signup_invitations on auth.users (after
--    insert, internal.claim_signup_invitations), which marks the matching
--    open member invitation used and the matching administrator invitation
--    signed up by the new account. Replaces
--    internal.claim_owner_admin_invitation (checked against its reviewed
--    body): unchanged except that an administrator invitation already signed
--    up by one account is claimed only by that account when it enrols an
--    authenticator app (an invitation from before this update, with no
--    sign-up recorded, is claimed as before).
-- 10. Replaces internal.acceptance_signup_guard (checked against its reviewed
--    body). Same refusal text "Registration is not open yet" (the website
--    matches it) and same invoker rights. It admits an address with an
--    unrevoked administrator invitation not yet signed up, or an unrevoked,
--    unused, unexpired member invitation, in either mode. Otherwise, in
--    'invite_only' mode it refuses as before; in 'open' mode it admits
--    everyone except an address internal.signup_email_domain_refused refuses,
--    which gets "Registration is not available for this email address" (403).
-- 11. Replaces internal.run_retention (checked against its reviewed body):
--    also runs internal.purge_member_invitations, which deletes member
--    invitations 30 days after they expired or were revoked and invitation
--    events older than 12 months ("member_invitations": the number of
--    invitations deleted). Every other step is unchanged.
-- 12. Replaces internal.erase_closed_account (checked against its reviewed
--    body): also deletes the person's member invitations (the one they used
--    and any for their address) and those addresses' invitation events.
--    Every other step is unchanged.
--
-- The mode starts as 'invite_only', so nothing changes for visitors when this
-- update is applied: administrator invitations admit and promote as before,
-- once each. Opening sign-up (launch, item 60) is one owner SQL editor call:
--   select internal.set_signup_mode('open', '<reason>', '<owner admin email>');
-- with the hosted "Before user created" hook left switched on (it now admits
-- everyone in 'open' mode); switching the hook off would also drop the domain
-- check.
--
-- ORDER: apply first, then merge. The release check refuses to deploy the
-- website release while production lacks api.get_signup_mode and
-- api.check_email_domain. After 20261119172135_post_views_and_likes.sql in
-- filename order. Read-only preflight:
-- ../preflight/20261120040242_signup_mode_member_invitations.check.sql.
-- Rollback: ../rollback/20261120040242_signup_mode_member_invitations.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does, and the
-- four functions it replaces have their reviewed bodies (or this update's).
do $$
declare present integer; shape text;
begin
  select (to_regclass('private.signup_settings') is not null)::integer
    + (to_regclass('private.signup_mode_events') is not null)::integer
    + (to_regclass('private.member_invitations') is not null)::integer
    + (to_regclass('private.member_invitation_events') is not null)::integer
    + (to_regclass('private.signup_blocked_domains') is not null)::integer
    + (exists (select 1 from pg_attribute a
        where a.attrelid = 'private.owner_admin_invitations'::regclass
          and a.attname = 'signed_up_by' and not a.attisdropped))::integer
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
    + (to_regprocedure('internal.claim_signup_invitations()') is not null)::integer
    + (to_regprocedure('internal.signup_email_domain_refused(text)') is not null)::integer
    + (to_regprocedure('internal.check_email_domain(text)') is not null)::integer
    + (to_regprocedure('api.check_email_domain(text)') is not null)::integer
  into present;
  if present not in (0, 21) then
    raise exception 'signup mode precondition: % of 21 objects exist', present
      using errcode='55000';
  end if;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
        where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.acceptance_signup_guard(jsonb)'), ('internal.run_retention(integer)'),
      ('internal.claim_owner_admin_invitation()'), ('internal.erase_closed_account(uuid,text)')) v(sig)
  loop
    if shape not in (
        'internal.acceptance_signup_guard(jsonb) 6afecd39f7374ea9f67f2c39d56d3c9b',
        'internal.acceptance_signup_guard(jsonb) ec177bcab50484d29df3782844624b0f',
        'internal.run_retention(integer) 06a3fbfcb5b2d53e2487719174a62cc5',
        'internal.run_retention(integer) 95dda89b3f540a74110a0ca1eba02e66',
        'internal.claim_owner_admin_invitation() a2313942c8eb9e5cb0f9be64f64ca025',
        'internal.claim_owner_admin_invitation() 7bb53811b07c4cde91df59201627a7b7',
        'internal.erase_closed_account(uuid,text) c1352cec14d02d401b58e466c387d747',
        'internal.erase_closed_account(uuid,text) 1e8253098e47fd6773f8b9298cc9f722') then
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

-- 2. The record of every change (kept; see the header).
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
  claimed_by uuid,
  claimed_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  constraint member_invitations_pkey primary key (email),
  constraint member_invitations_email_check check (email = lower(btrim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+[.][^@[:space:][:cntrl:]]+$'),
  constraint member_invitations_expiry_check check (expires_at > invited_at),
  constraint member_invitations_claimed_check check (claimed_by is null or claimed_at is not null),
  constraint member_invitations_revoked_check check (revoked_by is null or revoked_at is not null),
  constraint member_invitations_invited_by_fkey foreign key (invited_by)
    references auth.users(id) on delete set null,
  constraint member_invitations_claimed_by_fkey foreign key (claimed_by)
    references auth.users(id) on delete set null,
  constraint member_invitations_revoked_by_fkey foreign key (revoked_by)
    references auth.users(id) on delete set null
);
alter table private.member_invitations owner to postgres;
alter table private.member_invitations enable row level security;
revoke all on private.member_invitations from public, anon, authenticated, service_role;
create index if not exists member_invitations_invited_by_idx
  on private.member_invitations using btree (invited_by) where invited_by is not null;
create index if not exists member_invitations_claimed_by_idx
  on private.member_invitations using btree (claimed_by) where claimed_by is not null;
create index if not exists member_invitations_revoked_by_idx
  on private.member_invitations using btree (revoked_by) where revoked_by is not null;
create index if not exists member_invitations_invited_at_idx
  on private.member_invitations using btree (invited_at);

-- 6. Their history.
create table if not exists private.member_invitation_events (
  id uuid not null default gen_random_uuid(),
  email text not null,
  action text not null,
  actor_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint member_invitation_events_pkey primary key (id),
  constraint member_invitation_events_email_check check (char_length(email) between 3 and 254),
  constraint member_invitation_events_action_check check (action in ('invite', 'renew', 'revoke')),
  constraint member_invitation_events_actor_id_fkey foreign key (actor_id)
    references auth.users(id) on delete restrict
);
alter table private.member_invitation_events owner to postgres;
alter table private.member_invitation_events enable row level security;
revoke all on private.member_invitation_events from public, anon, authenticated, service_role;
create index if not exists member_invitation_events_actor_idx
  on private.member_invitation_events using btree (actor_id, created_at);
create index if not exists member_invitation_events_email_idx
  on private.member_invitation_events using btree (email);
create index if not exists member_invitation_events_created_at_idx
  on private.member_invitation_events using btree (created_at);
drop trigger if exists member_invitation_events_append_only on private.member_invitation_events;
create trigger member_invitation_events_append_only before delete or update on private.member_invitation_events
  for each row execute function internal.append_only_guard();
drop trigger if exists member_invitation_events_no_truncate on private.member_invitation_events;
create trigger member_invitation_events_no_truncate before truncate on private.member_invitation_events
  for each statement execute function internal.append_only_guard();

-- 7. Staff commands (admin role, capability member:invite).
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
  invited timestamptz;
  expires timestamptz;
  added boolean;
begin
  if clean is null or char_length(clean) not between 3 and 254
    or clean !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+[.][^@[:space:][:cntrl:]]+$' then
    raise exception 'member_invitation_email_invalid' using errcode = '22023';
  end if;
  -- An address that already has an account needs no invitation (owner
  -- decision of 20 November 2026; staff may learn that it has one).
  if exists (select 1 from auth.users u where lower(u.email) = clean and u.deleted_at is null) then
    raise exception 'This person already has an account.' using errcode = 'PT409',
      detail = 'member_invitation_account_exists';
  end if;
  -- One invitation at a time per staff member, so the daily limit holds. It
  -- counts the staff member's own invitations and renewals, whoever's
  -- invitation row they touched.
  perform pg_advisory_xact_lock(hashtext('private.member_invitations:' || actor::text));
  select count(*) into recent from private.member_invitation_events e
  where e.actor_id = actor and e.action in ('invite', 'renew')
    and e.created_at > statement_timestamp() - interval '24 hours';
  if recent >= 200 then
    raise exception 'member_invitation_limit' using errcode = '54000';
  end if;
  insert into private.member_invitations as m (email, invited_by)
    values (clean, actor)
    on conflict (email) do update set invited_by = excluded.invited_by,
      invited_at = statement_timestamp(), expires_at = statement_timestamp() + interval '30 days',
      claimed_by = null, claimed_at = null, revoked_by = null, revoked_at = null
    returning m.invited_at, m.expires_at, (m.xmax = 0) into invited, expires, added;
  insert into private.member_invitation_events(email, action, actor_id)
    values (clean, case when added then 'invite' else 'renew' end, actor);
  return jsonb_build_object('email', clean, 'invited_at', invited, 'expires_at', expires);
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
  revoked boolean;
begin
  if clean is null or char_length(clean) not between 3 and 254 then
    raise exception 'member_invitation_email_invalid' using errcode = '22023';
  end if;
  update private.member_invitations m set revoked_by = actor, revoked_at = statement_timestamp()
  where m.email = clean and m.revoked_at is null;
  revoked := found;
  if revoked then
    insert into private.member_invitation_events(email, action, actor_id)
      values (clean, 'revoke', actor);
  end if;
  return jsonb_build_object('email', clean, 'revoked', revoked);
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
        'claimed_at', m.claimed_at,
        'revoked_at', m.revoked_at,
        'status', case when m.revoked_at is not null then 'revoked'
          when m.claimed_at is not null then 'used'
          when m.expires_at <= statement_timestamp() then 'expired' else 'open' end,
        'registered', exists (select 1 from auth.users u
          where u.id = m.claimed_by and u.deleted_at is null))
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

-- 8. Blocked email domains (used only while sign-up is open) and the one
-- domain rule.
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

-- Invoker rights: run by the hook as the Auth service role, and by
-- internal.check_email_domain as the owner.
CREATE OR REPLACE FUNCTION internal.signup_email_domain_refused(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select x.domain is null
    or x.domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    or substring(x.domain from '[^.]+$') ~ '^[0-9]+$'
    or substring(x.domain from '[^.]+$') in ('test', 'example', 'invalid', 'localhost', 'local',
      'internal', 'onion', 'arpa', 'lan', 'home', 'corp', 'intranet')
    or x.domain in ('example.com', 'example.net', 'example.org')
    or exists (select 1 from private.signup_blocked_domains b
      where x.domain = b.domain or right(x.domain, char_length(b.domain) + 1) = '.' || b.domain)
  from (select substring(lower(btrim(p_email)) from '@([^@]+)$') as domain) x;
$function$;
alter function internal.signup_email_domain_refused(text) owner to postgres;
revoke all on function internal.signup_email_domain_refused(text) from public, anon, authenticated, service_role;
grant execute on function internal.signup_email_domain_refused(text) to supabase_auth_admin;

CREATE OR REPLACE FUNCTION internal.check_email_domain(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_email is null or char_length(p_email) > 320 then
    raise exception 'email_invalid' using errcode = '22023';
  end if;
  return jsonb_build_object('allowed',
    coalesce((select s.mode from private.signup_settings s where s.id), 'invite_only') <> 'open'
    or not internal.signup_email_domain_refused(p_email));
end;
$function$;
alter function internal.check_email_domain(text) owner to postgres;
revoke all on function internal.check_email_domain(text) from public, anon, authenticated, service_role;
grant execute on function internal.check_email_domain(text) to authenticated;

CREATE OR REPLACE FUNCTION api.check_email_domain(p_email text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.check_email_domain(p_email);
$function$;
alter function api.check_email_domain(text) owner to postgres;
revoke all on function api.check_email_domain(text) from public, anon, authenticated, service_role;
grant execute on function api.check_email_domain(text) to authenticated;

-- 9. One sign-up per invitation.
alter table private.owner_admin_invitations
  add column if not exists signed_up_by uuid,
  add column if not exists signed_up_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint
      where conname = 'owner_admin_invitations_signed_up_by_fkey') then
    alter table private.owner_admin_invitations add constraint owner_admin_invitations_signed_up_by_fkey
      foreign key (signed_up_by) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint
      where conname = 'owner_admin_invitations_signed_up_check') then
    alter table private.owner_admin_invitations add constraint owner_admin_invitations_signed_up_check
      check (signed_up_by is null or signed_up_at is not null);
  end if;
end$$;
create index if not exists owner_admin_invitations_signed_up_by_idx
  on private.owner_admin_invitations using btree (signed_up_by) where signed_up_by is not null;
-- An invitation whose address already has an account has been used.
update private.owner_admin_invitations i set signed_up_by = u.id, signed_up_at = u.created_at
  from auth.users u
  where i.signed_up_at is null and u.email = i.email and u.created_at is not null;

CREATE OR REPLACE FUNCTION internal.claim_signup_invitations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.email is null or new.is_anonymous then return new; end if;
  update private.member_invitations m set claimed_by = new.id, claimed_at = statement_timestamp()
  where m.email = lower(new.email) and m.claimed_at is null and m.revoked_at is null
    and m.expires_at > statement_timestamp();
  update private.owner_admin_invitations i set signed_up_by = new.id, signed_up_at = statement_timestamp()
  where i.email = lower(new.email) and i.signed_up_at is null and i.revoked_at is null;
  return new;
end;
$function$;
alter function internal.claim_signup_invitations() owner to postgres;
revoke all on function internal.claim_signup_invitations() from public, anon, authenticated, service_role;

drop trigger if exists claim_signup_invitations on auth.users;
create trigger claim_signup_invitations after insert on auth.users
  for each row execute function internal.claim_signup_invitations();

CREATE OR REPLACE FUNCTION internal.claim_owner_admin_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare invitation private.owner_admin_invitations; account_email text;
begin
  if new.factor_type <> 'totp' or new.status <> 'verified' then return new; end if;
  select lower(u.email) into account_email from auth.users u
    join private.current_account_access a on a.id=u.id
    where u.id=new.user_id and u.email_confirmed_at is not null and u.is_anonymous is false;
  if not found then return new; end if;
  -- An invitation already signed up by an account is claimed only by that
  -- account (20261120040242_signup_mode_member_invitations.sql).
  select * into invitation from private.owner_admin_invitations i
    where i.email=account_email and i.claimed_at is null and i.revoked_at is null
      and (i.signed_up_by is null or i.signed_up_by=new.user_id) for update;
  if not found then return new; end if;
  -- Serialise with the first-administrator bootstrap and ordinary role grants.
  lock table private.staff_roles in share row exclusive mode;
  if exists(select 1 from private.staff_roles r where r.user_id=new.user_id) then
    return new; -- A prior/revoked assignment is never reactivated by an invitation.
  end if;
  insert into private.staff_roles(user_id,role) values(new.user_id,'admin');
  update private.owner_admin_invitations set claimed_by=new.user_id,claimed_at=now()
    where email=invitation.email;
  return new;
end;
$function$;
alter function internal.claim_owner_admin_invitation() owner to postgres;
revoke all on function internal.claim_owner_admin_invitation() from public;

-- What the sign-up hook (run as the Auth service role) may read.
grant usage on schema private to supabase_auth_admin;
grant select (signed_up_at) on private.owner_admin_invitations to supabase_auth_admin;
grant select (id, mode) on private.signup_settings to supabase_auth_admin;
drop policy if exists signup_settings_signup_hook on private.signup_settings;
create policy signup_settings_signup_hook on private.signup_settings
  for select to supabase_auth_admin using (true);
grant select (email, expires_at, claimed_at, revoked_at) on private.member_invitations to supabase_auth_admin;
drop policy if exists member_invitations_signup_hook on private.member_invitations;
create policy member_invitations_signup_hook on private.member_invitations
  for select to supabase_auth_admin using (true);
grant select (domain) on private.signup_blocked_domains to supabase_auth_admin;
drop policy if exists signup_blocked_domains_signup_hook on private.signup_blocked_domains;
create policy signup_blocked_domains_signup_hook on private.signup_blocked_domains
  for select to supabase_auth_admin using (true);

-- 10. The sign-up hook.
CREATE OR REPLACE FUNCTION internal.acceptance_signup_guard(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with applicant as (
    select lower(p_event #>> '{user,email}') as email
    where jsonb_typeof(p_event #> '{user,email}') = 'string'
  )
  select case
    when not exists (select 1 from applicant)
      then '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb
    when exists (select 1 from applicant a join private.owner_admin_invitations i
        on i.email = a.email where i.revoked_at is null and i.signed_up_at is null)
      or exists (select 1 from applicant a join private.member_invitations m
        on m.email = a.email where m.revoked_at is null and m.claimed_at is null
          and m.expires_at > statement_timestamp())
      then '{}'::jsonb
    when coalesce((select s.mode from private.signup_settings s where s.id), 'invite_only') <> 'open'
      then '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb
    when exists (select 1 from applicant a where internal.signup_email_domain_refused(a.email))
      then '{"error":{"http_code":403,"message":"Registration is not available for this email address"}}'::jsonb
    else '{}'::jsonb end;
$function$;
alter function internal.acceptance_signup_guard(jsonb) owner to postgres;
revoke all on function internal.acceptance_signup_guard(jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.acceptance_signup_guard(jsonb) to supabase_auth_admin;

-- 11. Retention.
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
  -- Events are append-only; the retention job (vm.retention on) may delete
  -- those older than 12 months.
  delete from private.member_invitation_events e where e.id in (
    select x.id from private.member_invitation_events x
    where x.created_at < statement_timestamp() - interval '12 months'
    order by x.created_at limit p_limit);
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

-- 12. Account erasure.
CREATE OR REPLACE FUNCTION internal.erase_closed_account(p_user uuid, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare er private.account_erasures; reason text; earlier_retention text; counts jsonb := '{}'::jsonb; n integer;
begin
  if p_user is null or p_by is null or p_by not in ('staff', 'sweep') then
    raise exception 'account and erasing party required' using errcode = '22023';
  end if;
  perform internal.lock_evidence_subject(p_user);
  select * into er from private.account_erasures e where e.user_id = p_user for update;
  if not found then raise exception 'account is not closed' using errcode = 'PT404', detail = 'account_not_closed'; end if;
  if er.erased_at is not null or er.erase_after > statement_timestamp() then
    return internal.account_erasure_state(p_user);
  end if;
  reason := internal.account_erasure_hold(p_user);
  if reason is not null then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = reason
      where user_id = p_user;
    return internal.account_erasure_state(p_user);
  end if;
  earlier_retention := coalesce(pg_catalog.current_setting('vm.retention', true), '');
  perform pg_catalog.set_config('vm.retention', 'on', true);
  perform pg_catalog.set_config('vm.erasure', p_user::text, true);

  select count(*) into n from private.enquiries q where q.owner_id = p_user or q.sender_account_id = p_user;
  counts := counts || jsonb_build_object('enquiries', n);
  -- Enquiries the account sent, with the other owner's notice and email.
  with gone as (
    delete from private.enquiries q where q.sender_account_id = p_user returning q.id
  ), notices as (
    delete from private.notifications x using gone where x.kind = 'enquiry_received' and x.subject_id = gone.id
  )
  delete from private.outbox_events o using gone where o.kind = 'enquiry_received' and o.subject_id = gone.id;
  -- Sponsored places first: deleting a place returns its grant.
  delete from private.organisation_sponsorships s where s.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('sponsored_places', n);
  -- Posts, with their edit copies, contacts, media links, search documents,
  -- received enquiries and everything else that belongs to a post.
  delete from private.posts p where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('posts', n);
  delete from private.event_submissions e where e.owner_id = p_user;
  delete from private.enquiries q where q.owner_id = p_user;
  delete from private.notifications x where x.account_id = p_user;
  delete from private.outbox_events o where o.owner_id = p_user;
  delete from private.profiles x where x.account_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('profile', n);
  -- Likes made signed in (20261119172135_post_views_and_likes.sql).
  delete from private.post_likes l where l.account_id = p_user;
  delete from private.frontend_form_drafts d where d.owner_id = p_user;
  delete from private.listing_price_drafts d where d.owner_id = p_user;
  delete from private.intro_trial_requests t where t.owner_id = p_user;
  delete from private.frontend_business_checks b where b.owner_id = p_user;
  delete from private.organisation_admins a where a.account_id = p_user;
  delete from private.organisation_applications a where a.applicant_id = p_user;
  delete from private.entitlement_members m where m.member_id = p_user or m.added_by = p_user
    or m.entitlement_id in (select e.id from private.entitlements e where e.owner_id = p_user);
  delete from private.frontend_post_commands c where c.owner_id = p_user;
  delete from private.frontend_post_action_receipts r where r.owner_id = p_user;
  delete from private.account_acquisitions a where a.account_id = p_user;
  delete from private.communication_choice_events c where c.account_id = p_user;
  delete from private.signup_terms_acceptances a where a.account_id = p_user;
  delete from private.posting_terms_acceptances a where a.owner_id = p_user;
  -- Member invitations (20261120040242_signup_mode_member_invitations.sql):
  -- the one the account used and any for its address, with their history.
  delete from private.member_invitation_events e where e.email in (
    select m.email from private.member_invitations m where m.claimed_by = p_user
    union select lower(u.email) from auth.users u where u.id = p_user and u.email is not null);
  delete from private.member_invitations m where m.claimed_by = p_user
    or m.email = (select lower(u.email) from auth.users u where u.id = p_user);
  delete from private.verification_localities l where l.owner_id = p_user;
  -- Photos and videos nothing kept still uses: queued for deletion from
  -- storage now (the media cleanup job deletes the objects).
  update private.media_objects m set state = 'cleanup_required', cleanup_lease_until = null
    where m.owner_id = p_user and m.state in ('intent', 'ready', 'rejected') and not internal.media_object_in_use(m.id);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('media_queued', n);

  -- Paid time ends; payment records stay for their tax years, no longer
  -- linked to the account.
  update private.entitlements e set status = 'revoked', revoked_reason = 'account_erased'
    where e.owner_id = p_user and e.status <> 'revoked';
  update private.trial_identities t set owner_id = null, entitlement_id = null,
      detached_at = er.closed_at, retain_until = er.closed_at + interval '3 years'
    where t.owner_id = p_user;
  update private.post_activations a set owner_id = null where a.owner_id = p_user;
  update private.entitlements e set owner_id = null where e.owner_id = p_user;
  update private.payments p set owner_id = null where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('payments_unlinked', n);
  update private.customer_invoices i set account_id = null where i.account_id = p_user;
  update private.invoice_transfers t set account_id = null where t.account_id = p_user;
  update private.payment_refund_requests r set account_id = null where r.account_id = p_user;
  update private.partner_commissions c set referred_account_id = null where c.referred_account_id = p_user;
  update private.individual_slot_limits l set account_id = null where l.account_id = p_user;
  update private.slot_packages k set owner_id = null where k.owner_id = p_user;
  -- Package invoice requests (20261119025106): an open one is withdrawn (it
  -- leaves the staff queue), then every one is kept unlinked like its invoice.
  update private.package_invoice_requests r set status = 'withdrawn', closed_at = statement_timestamp()
    where r.account_id = p_user and r.status in ('requested', 'awaiting_approval');
  update private.package_invoice_requests r set account_id = null where r.account_id = p_user;

  perform internal.remove_account_sign_in(p_user);
  perform pg_catalog.set_config('vm.erasure', '', true);
  perform pg_catalog.set_config('vm.retention', earlier_retention, true);
  update private.account_erasures set erased_at = statement_timestamp(), erased_by = p_by, erased_counts = counts,
      blocked_at = null, blocked_reason = null, auth_checked_at = statement_timestamp()
    where user_id = p_user;
  -- Deleting the Auth user never undoes the finished erasure: a failure is
  -- recorded and the daily check tries again.
  begin
    if internal.remove_erased_auth_user(p_user) then
      update private.account_erasures set auth_removed_at = statement_timestamp() where user_id = p_user;
    end if;
  exception when others then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = 'error',
        blocked_detail = sqlstate
      where user_id = p_user;
  end;
  return internal.account_erasure_state(p_user);
end;
$function$;
alter function internal.erase_closed_account(uuid,text) owner to postgres;
revoke all on function internal.erase_closed_account(uuid,text) from public;

notify pgrst,'reload schema';
commit;
