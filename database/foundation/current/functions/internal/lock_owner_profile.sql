-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_owner_profile(p_expected_revision integer)
 RETURNS private.profiles
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); p private.profiles;
begin
  if p_expected_revision is null or p_expected_revision not between 1 and 2147483646 then
    raise exception 'positive expected revision required' using errcode='22023'; end if;
  insert into private.profiles(account_id) values(actor) on conflict(account_id) do nothing;
  select * into p from private.profiles where account_id=actor for update;
  perform internal.price_draft_actor();
  if p.revision<>p_expected_revision then
    raise exception 'profile changed; reload it' using errcode='PT409',detail='profile_changed'; end if;
  return p;
end;
$function$;
alter function internal.lock_owner_profile(integer) owner to postgres;
revoke all on function internal.lock_owner_profile(integer) from public;
