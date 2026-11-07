-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_frontend_organisation_profile(p_slug text, p_patch jsonb, p_reason text, p_id uuid DEFAULT NULL::uuid, p_expected integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare current_row private.organisations;result jsonb;new_id uuid;
begin
  perform internal.staff_actor('organisation:manage');
  if p_slug is null or length(p_slug) not between 3 and 60 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or jsonb_typeof(p_patch) is distinct from 'object' or (p_id is null)<>(p_expected is null)
    or exists(select 1 from jsonb_object_keys(p_patch) k where k not in(
      'name','organisation_type','description','programme_description','service_area','province_id',
      'website','public_email','public_phone','sponsored_capacity','affiliation_wording','sponsorship_wording',
      'is_public','accepting_applications','show_on_strip','show_on_home','display_order'))
    then raise exception 'invalid organisation profile' using errcode='22023',detail='organisation_invalid';end if;
  if p_id is null then
    if p_patch ?| array['is_public','accepting_applications','show_on_strip','show_on_home']
      then raise exception 'new organisations are private until reviewed' using errcode='22023',detail='organisation_invalid';end if;
    result:=internal.create_organisation(p_slug,p_patch->>'name',p_patch->>'organisation_type',p_reason);
    new_id:=(result->>'id')::uuid;
    return internal.update_organisation(new_id,(result->>'revision')::integer,p_patch,p_reason);
  end if;
  select * into current_row from private.organisations where id=p_id for update;
  if not found then raise exception 'organisation unavailable' using errcode='PT404',detail='organisation_unavailable';end if;
  result:=internal.update_organisation(p_id,p_expected,
    case when p_patch='{}'::jsonb then jsonb_build_object('name',current_row.name) else p_patch end,p_reason);
  if p_slug<>current_row.slug then
    begin
      update private.organisations set slug=p_slug where id=p_id;
    exception when unique_violation then
      raise exception 'organisation slug is already used' using errcode='PT409',detail='organisation_slug_taken';
    end;
    result:=jsonb_set(result,'{slug}',to_jsonb(p_slug));
  end if;
  perform internal.staff_actor('organisation:manage');
  return result;
end$function$;
alter function internal.save_frontend_organisation_profile(text,jsonb,text,uuid,integer) owner to postgres;
revoke all on function internal.save_frontend_organisation_profile(text,jsonb,text,uuid,integer) from public;
grant execute on function internal.save_frontend_organisation_profile(text,jsonb,text,uuid,integer) to authenticated;
