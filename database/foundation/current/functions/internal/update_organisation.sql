-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.update_organisation(p_id uuid, p_expected_revision integer, p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations; k text; t text;
  text_keys text[]:=array['name','organisation_type','description','programme_description','service_area','province_id',
    'website','public_email','public_phone','programme_status','affiliation_wording','sponsorship_wording'];
  bool_keys text[]:=array['is_public','accepting_applications','show_on_strip','show_on_home'];
  int_keys text[]:=array['sponsored_capacity','admin_limit','display_order'];
  time_keys text[]:=array['programme_starts_at','programme_ends_at'];
begin
  perform internal.organisation_reason(p_reason);
  if p_expected_revision is null or p_expected_revision not between 1 and 2147483646
    or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb then
    raise exception 'organisation details are invalid' using errcode='22023',detail='organisation_invalid'; end if;
  for k,t in select key,jsonb_typeof(value) from jsonb_each(p_patch) loop
    if not((k=any(text_keys) and t in('string','null')) or (k=any(bool_keys) and t='boolean')
      or (k=any(int_keys) and t='number') or (k=any(time_keys) and t in('string','null'))) then
      raise exception 'organisation details are invalid' using errcode='22023',detail='organisation_invalid'; end if;
  end loop;
  select * into o from private.organisations where id=p_id for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  actor:=internal.staff_actor('organisation:manage');
  if o.revision<>p_expected_revision then
    raise exception 'organisation changed; reload it' using errcode='PT409',detail='organisation_changed'; end if;
  begin
    update private.organisations x set
      name=case when p_patch?'name' then p_patch->>'name' else x.name end,
      organisation_type=case when p_patch?'organisation_type' then p_patch->>'organisation_type' else x.organisation_type end,
      description=case when p_patch?'description' then p_patch->>'description' else x.description end,
      programme_description=case when p_patch?'programme_description' then p_patch->>'programme_description' else x.programme_description end,
      service_area=case when p_patch?'service_area' then p_patch->>'service_area' else x.service_area end,
      province_id=case when p_patch?'province_id' then p_patch->>'province_id' else x.province_id end,
      website=case when p_patch?'website' then p_patch->>'website' else x.website end,
      public_email=case when p_patch?'public_email' then p_patch->>'public_email' else x.public_email end,
      public_phone=case when p_patch?'public_phone' then p_patch->>'public_phone' else x.public_phone end,
      programme_status=case when p_patch?'programme_status' then p_patch->>'programme_status' else x.programme_status end,
      affiliation_wording=case when p_patch?'affiliation_wording' then p_patch->>'affiliation_wording' else x.affiliation_wording end,
      sponsorship_wording=case when p_patch?'sponsorship_wording' then p_patch->>'sponsorship_wording' else x.sponsorship_wording end,
      is_public=case when p_patch?'is_public' then (p_patch->>'is_public')::boolean else x.is_public end,
      accepting_applications=case when p_patch?'accepting_applications' then (p_patch->>'accepting_applications')::boolean else x.accepting_applications end,
      show_on_strip=case when p_patch?'show_on_strip' then (p_patch->>'show_on_strip')::boolean else x.show_on_strip end,
      show_on_home=case when p_patch?'show_on_home' then (p_patch->>'show_on_home')::boolean else x.show_on_home end,
      sponsored_capacity=case when p_patch?'sponsored_capacity' then (p_patch->>'sponsored_capacity')::integer else x.sponsored_capacity end,
      admin_limit=case when p_patch?'admin_limit' then (p_patch->>'admin_limit')::integer else x.admin_limit end,
      display_order=case when p_patch?'display_order' then (p_patch->>'display_order')::integer else x.display_order end,
      programme_starts_at=case when p_patch?'programme_starts_at' then (p_patch->>'programme_starts_at')::timestamptz else x.programme_starts_at end,
      programme_ends_at=case when p_patch?'programme_ends_at' then (p_patch->>'programme_ends_at')::timestamptz else x.programme_ends_at end,
      revision=x.revision+1,updated_at=statement_timestamp()
    where x.id=o.id returning * into o;
  exception when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
    or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception 'organisation details are invalid' using errcode='22023',detail='organisation_invalid';
  end;
  perform internal.record_organisation_event(o.id,actor,'organisation_updated',o.id,p_reason);
  return jsonb_build_object('id',o.id,'slug',o.slug,'revision',o.revision);
end;
$function$;
alter function internal.update_organisation(uuid,integer,jsonb,text) owner to postgres;
revoke all on function internal.update_organisation(uuid,integer,jsonb,text) from public;
grant execute on function internal.update_organisation(uuid,integer,jsonb,text) to authenticated;
