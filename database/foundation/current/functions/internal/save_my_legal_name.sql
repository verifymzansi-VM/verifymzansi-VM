-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_my_legal_name(p_expected_revision integer, p_first_name text, p_last_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare p private.profiles;
begin
  p:=internal.lock_owner_profile(p_expected_revision);
  if p.legal_name_locked_at is not null then
    raise exception 'verified name is locked' using errcode='PT409',detail='legal_name_locked'; end if;
  if not internal.person_name_valid(p_first_name) or not internal.person_name_valid(p_last_name) then
    raise exception 'legal name is invalid' using errcode='22023',detail='legal_name_invalid'; end if;
  if (p_first_name,p_last_name) is not distinct from (p.legal_first_name,p.legal_last_name) then
    return internal.owner_profile_dto(p); end if;
  update private.profiles set legal_first_name=p_first_name,legal_last_name=p_last_name,
    revision=revision+1,updated_at=statement_timestamp()
    where account_id=p.account_id returning * into p;
  return internal.owner_profile_dto(p);
end;
$function$;
alter function internal.save_my_legal_name(integer,text,text) owner to postgres;
revoke all on function internal.save_my_legal_name(integer,text,text) from public;
grant execute on function internal.save_my_legal_name(integer,text,text) to authenticated;
