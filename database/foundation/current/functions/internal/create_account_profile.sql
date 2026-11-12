-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.create_account_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.is_anonymous then return new; end if;
  insert into private.profiles(account_id,display_name)
    values(new.id,internal.signup_display_name(new.raw_user_meta_data))
    on conflict(account_id) do nothing;
  return new;
end;
$function$;
alter function internal.create_account_profile() owner to postgres;
revoke all on function internal.create_account_profile() from public;
