-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); p private.profiles;
begin
  insert into private.profiles(account_id) values(actor) on conflict(account_id) do nothing;
  select * into p from private.profiles where account_id=actor;
  return internal.owner_profile_dto(p);
end;
$function$;
alter function internal.get_my_profile() owner to postgres;
revoke all on function internal.get_my_profile() from public;
grant execute on function internal.get_my_profile() to authenticated;
