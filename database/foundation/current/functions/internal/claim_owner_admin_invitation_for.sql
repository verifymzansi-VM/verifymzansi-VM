-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_owner_admin_invitation_for(p_user uuid, p_new_check boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.claim_owner_admin_invitation_for(uuid,boolean) owner to postgres;
revoke all on function internal.claim_owner_admin_invitation_for(uuid,boolean) from public;
