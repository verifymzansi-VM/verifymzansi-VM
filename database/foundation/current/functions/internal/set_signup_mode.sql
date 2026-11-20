-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
revoke all on function internal.set_signup_mode(text,text,text) from public;
