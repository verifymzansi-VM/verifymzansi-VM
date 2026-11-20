-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_signup_mode()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('mode',
    coalesce((select s.mode from private.signup_settings s where s.id), 'invite_only'));
$function$;
alter function internal.get_signup_mode() owner to postgres;
revoke all on function internal.get_signup_mode() from public;
grant execute on function internal.get_signup_mode() to anon;
grant execute on function internal.get_signup_mode() to authenticated;
