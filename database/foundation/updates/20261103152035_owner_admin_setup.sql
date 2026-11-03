-- Owner-controlled invitations expose only the existing authenticator setup.
-- Actual staff authority is granted only after the same confirmed-account and
-- verified-TOTP checks as bootstrap_first_administrator. Browser/Service roles
-- cannot create, inspect or alter invitations. Seed addresses separately in an
-- owner SQL session; never accept an email/role supplied by a browser.
begin;

create table if not exists private.owner_admin_invitations (
  email text primary key check (email = lower(btrim(email)) and length(email) between 3 and 254),
  created_at timestamptz not null default now(),
  claimed_by uuid unique references auth.users(id) on delete restrict,
  claimed_at timestamptz,
  revoked_at timestamptz,
  check ((claimed_by is null) = (claimed_at is null))
);
alter table private.owner_admin_invitations enable row level security;
revoke all on private.owner_admin_invitations from public, anon, authenticated, service_role;

create or replace function internal.claim_owner_admin_invitation()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare invitation private.owner_admin_invitations; account_email text;
begin
  if new.factor_type <> 'totp' or new.status <> 'verified' then return new; end if;
  select lower(u.email) into account_email from auth.users u
    join private.current_account_access a on a.id=u.id
    where u.id=new.user_id and u.email_confirmed_at is not null and u.is_anonymous is false;
  if not found then return new; end if;
  select * into invitation from private.owner_admin_invitations i
    where i.email=account_email and i.claimed_at is null and i.revoked_at is null for update;
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
$$;
revoke all on function internal.claim_owner_admin_invitation() from public,anon,authenticated,service_role;
drop trigger if exists claim_owner_admin_invitation on auth.mfa_factors;
create trigger claim_owner_admin_invitation after insert or update of status on auth.mfa_factors
  for each row execute function internal.claim_owner_admin_invitation();

-- Preserve the installed function's signature, owner and execute grants. A
-- repeated application accepts only this exact extension, never unknown drift.
do $migration$
declare body text; marker text := E'  -- Owner invitation: setup hint only; no command authority.\n  if staff_role is null and not exists(select 1 from private.staff_roles r where r.user_id=actor)\n    and exists(select 1 from private.owner_admin_invitations i join auth.users u on lower(u.email)=i.email\n      where u.id=actor and u.email_confirmed_at is not null and u.is_anonymous is false\n      and i.claimed_at is null and i.revoked_at is null) then\n    staff_role:=\'admin\';\n  end if;\n';
begin
  select prosrc into strict body from pg_proc where oid='internal.get_my_account_context()'::regprocedure;
  if position(marker in body)>0 then
    if md5(replace(body,marker,''))<>'c2b6f447d0c2a00909bcd7058e8a6e99' then
      raise exception 'Unknown updated account-context function';
    end if;
    return;
  end if;
  if md5(body)<>'c2b6f447d0c2a00909bcd7058e8a6e99' then
    raise exception 'Unknown account-context function; review before applying admin setup';
  end if;
  body:=replace(body,E'  return jsonb_build_object(\'version\',1,\'account_id\',actor',
    marker||E'  return jsonb_build_object(\'version\',1,\'account_id\',actor');
  execute format('create or replace function internal.get_my_account_context() returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',body);
end;
$migration$;

commit;
