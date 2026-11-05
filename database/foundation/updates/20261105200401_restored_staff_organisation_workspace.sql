-- Staff reads and profile writes for the selected organisation workspace.
begin;
set local lock_timeout='5s';

create function internal.get_frontend_staff_organisation_directory()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  perform internal.staff_actor('organisation:manage');
  select jsonb_build_object('total',(select count(*) from private.organisations),
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,'slug',o.slug,'name',o.name,'organisation_type',o.organisation_type,
      'programme_status',o.programme_status,'is_public',o.is_public,
      'ends_at',o.programme_ends_at,'sponsored_capacity',o.sponsored_capacity,
      'affiliated',(select count(*) from private.organisation_affiliations f where f.organisation_id=o.id and f.status='active'),
      'pending',(select count(*) from private.organisation_applications a where a.organisation_id=o.id and a.status in('submitted','more_info_required')),
      'sponsored',(select count(*) from private.organisation_sponsorships s where s.organisation_id=o.id and s.status='active'))
      order by o.created_at desc,o.id),'[]'::jsonb))
    into result from (select * from private.organisations order by created_at desc,id limit 200)o;
  perform internal.staff_actor('organisation:manage');
  return result;
end$$;
create function api.get_frontend_staff_organisation_directory()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_frontend_staff_organisation_directory()
$$;
revoke all on function internal.get_frontend_staff_organisation_directory(),api.get_frontend_staff_organisation_directory() from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_staff_organisation_directory(),api.get_frontend_staff_organisation_directory() to authenticated;

create function internal.get_frontend_staff_organisation_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare detail jsonb;contacts jsonb;
begin
  perform internal.staff_actor('organisation:manage');
  detail:=internal.staff_get_organisation(p_id);
  if detail is null then return null;end if;
  select coalesce(jsonb_agg(jsonb_build_object('application_id',a.id,
    'phone',p.contacts->>'phone','email',p.data->>'email','website',p.data->>'website')
    order by a.created_at desc,a.id),'[]'::jsonb) into contacts
    from (select x.id,x.post_id,x.created_at from private.organisation_applications x
      where x.organisation_id=p_id and x.status<>'withdrawn'
      order by x.created_at desc,x.id limit 200)a
    join private.public_eligible_posts e on e.id=a.post_id
    join private.post_presentations p on p.post_id=e.id;
  perform internal.staff_actor('organisation:manage');
  return detail||jsonb_build_object('public_contacts',contacts);
end$$;
create function api.get_frontend_staff_organisation_detail(p_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_frontend_staff_organisation_detail(p_id)
$$;
revoke all on function internal.get_frontend_staff_organisation_detail(uuid),api.get_frontend_staff_organisation_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_staff_organisation_detail(uuid),api.get_frontend_staff_organisation_detail(uuid) to authenticated;

create function internal.save_frontend_organisation_profile(p_slug text,p_patch jsonb,p_reason text,p_id uuid default null,p_expected integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
end$$;
create function api.save_frontend_organisation_profile(p_slug text,p_patch jsonb,p_reason text,p_id uuid default null,p_expected integer default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_frontend_organisation_profile(p_slug,p_patch,p_reason,p_id,p_expected)
$$;
revoke all on function internal.save_frontend_organisation_profile(text,jsonb,text,uuid,integer),api.save_frontend_organisation_profile(text,jsonb,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.save_frontend_organisation_profile(text,jsonb,text,uuid,integer),api.save_frontend_organisation_profile(text,jsonb,text,uuid,integer) to authenticated;

notify pgrst,'reload schema';
commit;
