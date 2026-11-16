-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.end_account_sessions(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  delete from auth.sessions s where s.user_id = p_user;
  -- Hosted Auth only: refresh tokens name the account as text.
  if pg_catalog.to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1' using p_user::text;
  end if;
end;
$function$;
alter function internal.end_account_sessions(uuid) owner to postgres;
revoke all on function internal.end_account_sessions(uuid) from public;
