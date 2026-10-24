-- Current account view for browser/session integration. No caller-supplied id.
-- Profile access first enforces the existing live-session/account guard.
-- Staff UI hints reuse canonical staff_actor; they never grant command authority.
create function internal.get_my_account_context()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
  return jsonb_build_object('version',1,'account_id',actor,'email',account_email,
    'phone',account_phone,'profile',account_profile,'totp_enrolled',enrolled,
    'staff',case when staff_role is null then null else jsonb_build_object(
      'role',staff_role,'can_access',staff_ready,'assigned_capabilities',assigned) end);
end;
$$;
revoke all on function internal.get_my_account_context() from public,anon,authenticated,service_role;
grant execute on function internal.get_my_account_context() to authenticated;

create function api.get_my_account_context()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_my_account_context();
$$;
revoke all on function api.get_my_account_context() from public,anon,authenticated,service_role;
grant execute on function api.get_my_account_context() to authenticated;
