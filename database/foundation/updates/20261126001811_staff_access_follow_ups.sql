-- Staff access follow-ups (launch checklist item 56, batch F).
--
-- 1. An owner admin invitation is claimed by one helper,
--    internal.claim_owner_admin_invitation_for(uuid,boolean). Until now only a new or
--    newly verified authenticator app (the trigger on auth.mfa_factors)
--    claimed it, so a person invited after setting up an authenticator app
--    was never made an admin. A new trigger on private.owner_admin_invitations
--    now runs the same helper when the owner adds an invitation: the person
--    becomes an admin at once when their account already has a verified
--    authenticator app, and (as after any other role grant) their sessions
--    need a new two-step check before any staff command. The checks are
--    unchanged: a confirmed account that can
--    sign in, an unclaimed and unrevoked invitation for its email (only the
--    account that signed up with it, once one has), and no earlier staff role
--    (never reactivated). This update claims nothing itself; an invitation
--    already waiting for such a person is deleted and added again
--    (updates/README.md).
-- 2. The helper first takes the per-person lock (internal.lock_evidence_subject)
--    that ban approval, account closure, erasure orders and staff role changes
--    take, then reads whether the account can sign in, then locks the staff
--    roles table (the order of the staff role changes). An invitation claimed
--    at the moment a ban is approved, an account is closed or an erasure is
--    ordered therefore waits for it and then sees it, so it never leaves a
--    banned, closed or erased admin.
-- 3. internal.close_account_evidence (behind the service-only
--    api.close_account_evidence and internal.close_account_now) refuses an
--    account with an active staff role (PT409, detail staff_account), checked
--    under the same lock. Its callers that members and staff reach already
--    refused such accounts; the service command did not.
--
-- Expand only: two replaced bodies (internal.claim_owner_admin_invitation(),
-- internal.close_account_evidence(uuid)), one new helper, one new trigger
-- function and one new trigger; no command, argument, result or grant changes.
-- ORDER: apply first, then merge. No website code depends on it.
-- It refuses with 55000 unless both functions have their reviewed bodies (or
-- this update's).
-- Read-only preflight: ../preflight/20261126001811_staff_access_follow_ups.check.sql.
-- Rollback: ../rollback/20261126001811_staff_access_follow_ups.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.claim_owner_admin_invitation()');
  if body is null or body not in('9b58d1999a5babe02f2ab051cb79bcce','aad6e9487ca76eba953086e5054fad11') then
    raise exception 'staff access follow-ups precondition: internal.claim_owner_admin_invitation() is not a reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.close_account_evidence(uuid)');
  if body is null or body not in('ae0f20403df41b820bad1c96d93a0be1','1b447b3fe8805138814c3cdb0ceb6daa') then
    raise exception 'staff access follow-ups precondition: internal.close_account_evidence(uuid) is not a reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

-- The one place an owner admin invitation is claimed. Returns whether this
-- call made the account an admin. p_new_check: the person's sessions need a
-- new two-step check before any staff command (as internal.apply_frontend_staff_role
-- sets); used when the owner adds the invitation, not when the authenticator
-- app check that claims it has just happened.
create or replace function internal.claim_owner_admin_invitation_for(p_user uuid, p_new_check boolean default false)
returns boolean language plpgsql security definer set search_path to 'pg_catalog' as $$
declare invitation private.owner_admin_invitations; account_email text;
begin
  if p_user is null then return false; end if;
  -- The per-person lock of ban approval, closure, erasure and role changes,
  -- taken before anything about the account is read.
  perform internal.lock_evidence_subject(p_user);
  if not exists(select 1 from auth.mfa_factors f
      where f.user_id=p_user and f.factor_type='totp' and f.status='verified') then
    return false;
  end if;
  select lower(u.email) into account_email from auth.users u
    join private.current_account_access a on a.id=u.id
    where u.id=p_user and u.email_confirmed_at is not null and u.is_anonymous is false;
  if not found then return false; end if;
  -- An invitation already signed up by an account is claimed only by that
  -- account, never by a later one after it is erased
  -- (20261120040242_signup_mode_member_invitations.sql).
  select * into invitation from private.owner_admin_invitations i
    where i.email=account_email and i.claimed_at is null and i.revoked_at is null
      and (i.signed_up_at is null or i.signed_up_by=p_user) for update;
  if not found then return false; end if;
  -- Serialise with the first-administrator bootstrap and ordinary role grants.
  lock table private.staff_roles in share row exclusive mode;
  if exists(select 1 from private.staff_roles r where r.user_id=p_user) then
    return false; -- A prior/revoked assignment is never reactivated by an invitation.
  end if;
  insert into private.staff_roles(user_id,role,frontend_mfa_not_before)
    values(p_user,'admin',case when p_new_check then statement_timestamp() end);
  update private.owner_admin_invitations set claimed_by=p_user,claimed_at=now()
    where email=invitation.email;
  return true;
end$$;
alter function internal.claim_owner_admin_invitation_for(uuid,boolean) owner to postgres;
revoke all on function internal.claim_owner_admin_invitation_for(uuid,boolean) from public,anon,authenticated,service_role;

-- A new or newly verified authenticator app (trigger on auth.mfa_factors).
create or replace function internal.claim_owner_admin_invitation()
returns trigger language plpgsql security definer set search_path to 'pg_catalog' as $$
begin
  if new.factor_type <> 'totp' or new.status <> 'verified' then return new; end if;
  perform internal.claim_owner_admin_invitation_for(new.user_id);
  return new;
end$$;
revoke all on function internal.claim_owner_admin_invitation() from public,anon,authenticated,service_role;

-- A new invitation for an account that already has a verified authenticator
-- app: its existing sessions need a new two-step check before staff commands.
create or replace function internal.claim_new_owner_admin_invitation()
returns trigger language plpgsql security definer set search_path to 'pg_catalog' as $$
begin
  if new.claimed_at is not null or new.revoked_at is not null then return new; end if;
  perform internal.claim_owner_admin_invitation_for(u.id, true) from auth.users u
    where lower(u.email)=new.email and (new.signed_up_at is null or u.id=new.signed_up_by)
    order by u.id;
  return new;
end$$;
alter function internal.claim_new_owner_admin_invitation() owner to postgres;
revoke all on function internal.claim_new_owner_admin_invitation() from public,anon,authenticated,service_role;
drop trigger if exists claim_new_owner_admin_invitation on private.owner_admin_invitations;
create trigger claim_new_owner_admin_invitation after insert on private.owner_admin_invitations
  for each row execute function internal.claim_new_owner_admin_invitation();

create or replace function internal.close_account_evidence(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $$
declare closure private.account_closures; scheduled integer; trial_fingerprints integer;
begin
  perform internal.lock_evidence_subject(p_user_id);
  -- 20261126001811: never an account with an active staff role (the same
  -- check as internal.order_account_erasure), under the per-person lock an
  -- admin invitation claim also takes.
  if exists (select 1 from private.staff_roles s where s.user_id = p_user_id and s.revoked_at is null) then
    raise exception 'end the staff roles of this account first' using errcode = 'PT409', detail = 'staff_account';
  end if;
  perform e.id from private.evidence_cases e where e.subject_id=p_user_id order by e.id for update;
  insert into private.account_closures (user_id, closed_at, evidence_delete_after)
  values (p_user_id, statement_timestamp(), statement_timestamp() + interval '90 days')
  on conflict (user_id) do nothing;
  select * into closure from private.account_closures x where x.user_id = p_user_id;
  update private.evidence_artifacts a
    set retain_until = least(coalesce(a.retain_until,'infinity'::timestamptz), closure.evidence_delete_after)
  where a.owner_id = p_user_id and a.state in ('uploaded', 'clean', 'rejected')
    and a.retain_until is distinct from least(coalesce(a.retain_until,'infinity'::timestamptz), closure.evidence_delete_after);
  get diagnostics scheduled = row_count;
  -- DEC-27: detach the trial fingerprint and keep it 3 years after closure.
  update private.trial_identities set owner_id = null, entitlement_id = null,
    detached_at = closure.closed_at, retain_until = closure.closed_at + interval '3 years'
  where owner_id = p_user_id;
  get diagnostics trial_fingerprints = row_count;
  -- 20261119025106: an open package invoice request is withdrawn, so it leaves
  -- the staff queue and no invoice is issued to a closed account.
  update private.package_invoice_requests set status = 'withdrawn', closed_at = statement_timestamp()
    where account_id = p_user_id and status in ('requested', 'awaiting_approval');
  update private.evidence_cases set status = 'closed', claimed_by = null, claim_expires_at = null,claim_nonce=null,
    version=least(version::bigint+1,2147483647)::integer
  where subject_id = p_user_id and status = 'open' and kind in('kyc','business');
  return jsonb_build_object('closed_at', closure.closed_at,
    'evidence_delete_after', closure.evidence_delete_after, 'scheduled', scheduled,
    'trial_fingerprints_detached', trial_fingerprints);
end$$;
revoke all on function internal.close_account_evidence(uuid) from public,anon,authenticated;
grant execute on function internal.close_account_evidence(uuid) to service_role;
commit;
