-- One revision-fenced transaction for the existing profile form. Reuse native
-- validation/locks; a rejected locality must roll back the name and bio too.
begin;
create or replace function internal.save_restored_profile(p_expected_revision integer,p_display_name text,p_bio text,p_province text,p_city text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
$$;
revoke all on function internal.save_restored_profile(integer,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.save_restored_profile(integer,text,text,text,text) to authenticated;
create or replace function api.save_my_frontend_profile(p_expected_revision integer,p_display_name text default null,p_bio text default null,p_province text default null,p_city text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_restored_profile(p_expected_revision,p_display_name,p_bio,p_province,p_city);
$$;
revoke all on function api.save_my_frontend_profile(integer,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function api.save_my_frontend_profile(integer,text,text,text,text) to authenticated;
commit;
