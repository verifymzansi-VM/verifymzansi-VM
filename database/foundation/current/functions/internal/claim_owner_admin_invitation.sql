-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
$function$;
alter function internal.claim_owner_admin_invitation() owner to postgres;
revoke all on function internal.claim_owner_admin_invitation() from public;
