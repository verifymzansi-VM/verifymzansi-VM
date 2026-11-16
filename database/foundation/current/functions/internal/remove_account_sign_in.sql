-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.remove_account_sign_in(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare col name;
begin
  perform internal.end_account_sessions(p_user);
  delete from auth.mfa_factors f where f.user_id = p_user;
  -- Hosted Auth only: linked sign-in providers, one-time tokens, sign-in flows.
  if pg_catalog.to_regclass('auth.identities') is not null then
    execute 'delete from auth.identities where user_id = $1' using p_user;
  end if;
  if pg_catalog.to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens where user_id = $1' using p_user;
  end if;
  if pg_catalog.to_regclass('auth.flow_state') is not null then
    execute 'delete from auth.flow_state where user_id = $1' using p_user;
  end if;
  -- The Auth log has no index on the actor: one bounded batch, entries since
  -- the account was created only (the operations retention trims the rest).
  delete from auth.audit_log_entries a where a.id in (select x.id from auth.audit_log_entries x
    where x.created_at >= (select u.created_at - interval '1 day' from auth.users u where u.id = p_user)
      and x.payload->>'actor_id' = p_user::text
    limit 10000);
  update auth.users u set email = null, phone = null, encrypted_password = '', raw_user_meta_data = '{}'::jsonb,
      raw_app_meta_data = '{}'::jsonb, banned_until = statement_timestamp() + interval '100 years',
      deleted_at = coalesce(u.deleted_at, statement_timestamp())
    where u.id = p_user;
  -- Hosted Auth only: a pending address change and one-time codes.
  for col in
    select a.attname from pg_catalog.pg_attribute a
    where a.attrelid = 'auth.users'::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and a.attname in ('email_change', 'phone_change', 'confirmation_token', 'recovery_token',
        'email_change_token_new', 'email_change_token_current', 'phone_change_token', 'reauthentication_token')
    order by a.attname
  loop
    execute pg_catalog.format('update auth.users set %I = %L where id = %L', col, '', p_user);
  end loop;
end;
$function$;
alter function internal.remove_account_sign_in(uuid) owner to postgres;
revoke all on function internal.remove_account_sign_in(uuid) from public;
