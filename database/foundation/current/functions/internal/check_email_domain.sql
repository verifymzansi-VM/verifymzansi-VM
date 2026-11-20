-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.check_email_domain(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_email is null or char_length(p_email) > 320 then
    raise exception 'email_invalid' using errcode = '22023';
  end if;
  return jsonb_build_object('allowed',
    coalesce((select s.mode from private.signup_settings s where s.id), 'invite_only') <> 'open'
    or not internal.signup_email_domain_refused(p_email));
end;
$function$;
alter function internal.check_email_domain(text) owner to postgres;
revoke all on function internal.check_email_domain(text) from public;
grant execute on function internal.check_email_domain(text) to authenticated;
