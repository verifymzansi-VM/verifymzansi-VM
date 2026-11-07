-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_my_profile(p_expected_revision integer, p_display_name text, p_bio text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare p private.profiles; next_name text;
begin
  p:=internal.lock_owner_profile(p_expected_revision);
  if p.legal_name_locked_at is not null then
    if p_display_name is not null and p_display_name is distinct from p.display_name then
      raise exception 'verified name is locked' using errcode='PT409',detail='legal_name_locked'; end if;
    next_name:=p.display_name;
  else
    if not internal.person_name_valid(p_display_name) then
      raise exception 'display name is invalid' using errcode='22023',detail='display_name_invalid'; end if;
    if p_display_name is distinct from p.display_name and internal.person_name_reserved(p_display_name) then
      raise exception 'display name is reserved' using errcode='22023',detail='display_name_reserved'; end if;
    next_name:=p_display_name;
  end if;
  if p_bio is not null and not internal.profile_bio_valid(p_bio) then
    raise exception 'bio is invalid' using errcode='22023',detail='bio_invalid'; end if;
  if (next_name,p_bio) is not distinct from (p.display_name,p.bio) then return internal.owner_profile_dto(p); end if;
  update private.profiles set display_name=next_name,bio=p_bio,revision=revision+1,updated_at=statement_timestamp()
    where account_id=p.account_id returning * into p;
  return internal.owner_profile_dto(p);
end;
$function$;
alter function internal.save_my_profile(integer,text,text) owner to postgres;
revoke all on function internal.save_my_profile(integer,text,text) from public;
grant execute on function internal.save_my_profile(integer,text,text) to authenticated;
