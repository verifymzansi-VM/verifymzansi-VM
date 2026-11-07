-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.bootstrap_first_administrator(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.bootstrap_first_administrator(text) owner to postgres;
revoke all on function internal.bootstrap_first_administrator(text) from public;
