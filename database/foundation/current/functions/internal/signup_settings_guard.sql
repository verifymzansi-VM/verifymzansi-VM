-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
revoke all on function internal.signup_settings_guard() from public;
