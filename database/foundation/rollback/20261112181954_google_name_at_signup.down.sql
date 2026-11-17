-- Reviewed rollback for updates/20261112181954_google_name_at_signup.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. No website release depends on the
-- update, so it can be run at any time.
-- The rollback restores internal.create_account_profile byte for byte (new
-- profiles again read only the sign-up detail display_name) and drops
-- internal.signup_display_name. Display names the update's one-time fill gave
-- stay: each passes the person name rule, as a name the member typed would,
-- and the member can change it.
begin;
set local lock_timeout='5s';

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.create_account_profile()')) is distinct from '4a0e4e02cbae11e5059e6ee0e89d1046'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.signup_display_name(jsonb)')) is distinct from '52cf17d4e33c510c130e588771a9d106' then
    raise exception 'rollback precondition: the google name at signup update is not applied' using errcode='55000';
  end if;
end$$;

-- The profile trigger as it was before the update.
CREATE OR REPLACE FUNCTION internal.create_account_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare requested text;
begin
  if new.is_anonymous then return new; end if;
  if jsonb_typeof(new.raw_user_meta_data->'display_name')='string' then
    requested:=normalize(btrim(new.raw_user_meta_data->>'display_name'),NFC);
    if not internal.person_name_valid(requested) or internal.person_name_reserved(requested) then
      requested:=null; end if;
  end if;
  insert into private.profiles(account_id,display_name) values(new.id,requested)
    on conflict(account_id) do nothing;
  return new;
end;
$function$;
alter function internal.create_account_profile() owner to postgres;
revoke all on function internal.create_account_profile() from public;

drop function internal.signup_display_name(jsonb);
commit;
