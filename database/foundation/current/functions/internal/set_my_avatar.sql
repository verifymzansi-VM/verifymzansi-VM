-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_my_avatar(p_expected_revision integer, p_object_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare p private.profiles;
begin
  p:=internal.lock_owner_profile(p_expected_revision);
  if p_object_id is not distinct from p.avatar_object_id then return internal.owner_profile_dto(p); end if;
  if p_object_id is not null then
    perform 1 from private.media_objects m where m.id=p_object_id and m.owner_id=p.account_id
      and m.kind='image' and m.state='ready' for update;
    if not found then
      raise exception 'your own ready image is required' using errcode='22023',detail='avatar_unavailable'; end if;
  end if;
  if p.avatar_object_id is not null then
    update private.media_objects set unlinked_at=statement_timestamp() where id=p.avatar_object_id;
  end if;
  update private.profiles set avatar_object_id=p_object_id,revision=revision+1,updated_at=statement_timestamp()
    where account_id=p.account_id returning * into p;
  return internal.owner_profile_dto(p);
end;
$function$;
alter function internal.set_my_avatar(integer,uuid) owner to postgres;
revoke all on function internal.set_my_avatar(integer,uuid) from public;
grant execute on function internal.set_my_avatar(integer,uuid) to authenticated;
