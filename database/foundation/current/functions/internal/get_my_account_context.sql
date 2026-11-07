-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_account_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid;
  account_profile jsonb;
  account_email text;
  account_phone text;
  staff_role text;
  staff_ready boolean:=false;
  assigned text[]:=array[]::text[];
  enrolled boolean;
begin
  account_profile:=internal.get_my_profile();
  actor:=auth.uid();
  select u.email into account_email from auth.users u where u.id=actor;
  select p.phone into account_phone from private.verification_phone_proofs p
    where p.owner_id=actor and p.revoked_at is null;
  select exists(select 1 from auth.mfa_factors f where f.user_id=actor
    and f.factor_type='totp' and f.status='verified') into enrolled;
  select r.role into staff_role from private.staff_roles r
    where r.user_id=actor and r.revoked_at is null;
  if staff_role is not null then
    select coalesce(array_agg(c.capability order by c.capability),array[]::text[])
      into assigned from private.staff_capabilities c where c.role=staff_role;
    begin
      perform internal.staff_actor('queue:view');
      staff_ready:=true;
    exception when insufficient_privilege then
      staff_ready:=false;
    end;
  end if;
  -- Owner invitation: setup hint only; no command authority.
  if staff_role is null and not exists(select 1 from private.staff_roles r where r.user_id=actor)
    and exists(select 1 from private.owner_admin_invitations i join auth.users u on lower(u.email)=i.email
      where u.id=actor and u.email_confirmed_at is not null and u.is_anonymous is false
      and i.claimed_at is null and i.revoked_at is null) then
    staff_role:='admin';
  end if;
  return jsonb_build_object('version',1,'account_id',actor,'email',account_email,
    'phone',account_phone,'profile',account_profile,'totp_enrolled',enrolled,
    'staff',case when staff_role is null then null else jsonb_build_object(
      'role',staff_role,'can_access',staff_ready,'assigned_capabilities',assigned) end);
end;
$function$;
alter function internal.get_my_account_context() owner to postgres;
revoke all on function internal.get_my_account_context() from public;
grant execute on function internal.get_my_account_context() to authenticated;
