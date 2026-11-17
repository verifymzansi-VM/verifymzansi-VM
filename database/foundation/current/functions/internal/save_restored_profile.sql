-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_restored_profile(p_expected_revision integer, p_display_name text, p_bio text, p_province text, p_city text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); saved jsonb; location_result jsonb; p private.profiles;
begin
  -- Identity/locality commands take this lock before profile rows. Keep that
  -- order when composing the two native commands to avoid a lock inversion.
  perform internal.lock_verification_subject(actor);
  perform internal.price_draft_actor();
  if (p_province is null) <> (p_city is null) then
    raise exception 'select a province and city together' using errcode='22023',detail='location_invalid'; end if;
  saved:=internal.save_my_profile(p_expected_revision,p_display_name,p_bio);
  if p_province is not null then
    location_result:=internal.confirm_verification_locality(p_province,p_city);
    if location_result->>'reused' is distinct from 'true' and (saved->>'revision')::integer=p_expected_revision then
      update private.profiles set revision=revision+1,updated_at=statement_timestamp() where account_id=actor;
    end if;
  end if;
  select * into strict p from private.profiles where account_id=actor;
  perform internal.price_draft_actor();
  return internal.owner_profile_dto(p);
end;
$function$;
alter function internal.save_restored_profile(integer,text,text,text,text) owner to postgres;
revoke all on function internal.save_restored_profile(integer,text,text,text,text) from public;
grant execute on function internal.save_restored_profile(integer,text,text,text,text) to authenticated;
