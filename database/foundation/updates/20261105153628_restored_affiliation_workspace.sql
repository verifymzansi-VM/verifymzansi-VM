-- Owner-scoped affiliation workspace for the existing dashboard. Join the
-- current native posts, applications and organisation records in one read.
begin;
create function internal.get_frontend_affiliation_workspace(p_slug text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();result jsonb;
begin
  if p_slug is not null and (length(p_slug) not between 3 and 60 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    then raise exception 'valid organisation slug required' using errcode='22023',detail='organisation_invalid';end if;
  select jsonb_build_object('account_id',actor,
    'businesses',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(p.title,'Business'),'status',p.status)
      order by p.created_at desc,p.id) from (
        select * from private.posts p0 where p0.owner_id=actor and p0.kind='business' and p0.edit_of is null and p0.status<>'archived'
        order by p0.created_at desc,p0.id limit 1000)p),'[]'::jsonb),
    'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'organisation_id',a.organisation_id,'business_id',a.post_id,
      'status',a.status,'info_request',a.info_request,'decision_note',a.decision_note,'created_at',a.created_at,
      'organisations',jsonb_build_object('name',o.name,'slug',o.slug)) order by a.created_at desc,a.id)
      from (select * from private.organisation_applications x where x.applicant_id=actor and x.post_kind='business'
        order by x.created_at desc,x.id limit 100)a join private.organisations o on o.id=a.organisation_id),'[]'::jsonb),
    'affiliations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'organisation_id',a.organisation_id,'business_id',a.post_id,
      'confirmed_at',a.confirmed_at,'organisations',jsonb_build_object('name',o.name,'slug',o.slug,'affiliation_wording',o.affiliation_wording))
      order by a.confirmed_at desc,a.id) from (
        select x.* from private.organisation_affiliations x join private.posts p on p.id=x.post_id and p.owner_id=actor and p.kind='business'
        where x.status='active' order by x.confirmed_at desc,x.id limit 1000)a join private.organisations o on o.id=a.organisation_id),'[]'::jsonb),
    'administered',coalesce((select jsonb_agg(jsonb_build_object('name',o.name,'slug',o.slug,'programme_status',o.programme_status)
      order by o.name,o.slug) from private.organisation_admins a join private.organisations o on o.id=a.organisation_id
      where a.account_id=actor and o.programme_status<>'ended'),'[]'::jsonb),
    'preselected',(select jsonb_build_object('slug',o.slug,'name',o.name) from private.organisations o
      where o.slug=p_slug and internal.organisation_listed(o))
  ) into result;
  perform internal.price_draft_actor();return result;
end$$;
create function api.get_frontend_affiliation_workspace(p_slug text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_affiliation_workspace(p_slug)$$;
revoke all on function internal.get_frontend_affiliation_workspace(text),api.get_frontend_affiliation_workspace(text) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_affiliation_workspace(text),api.get_frontend_affiliation_workspace(text) to authenticated;

create function internal.execute_frontend_organisation_action(p_org uuid,p_item uuid,p_action text,p_value text default null,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.organisation_actor(p_org);result jsonb;
begin
  if p_action='decide' then
    if not exists(select 1 from private.organisation_applications a where a.id=p_item and a.organisation_id=p_org)
      then raise exception 'represented organisation application unavailable' using errcode='PT404',detail='application_unavailable';end if;
    result:=internal.org_decide_application(p_item,p_value,p_note);
  elsif p_action in('revoke','set_type','sponsor') then
    if not exists(select 1 from private.organisation_affiliations a where a.id=p_item and a.organisation_id=p_org)
      then raise exception 'represented affiliation unavailable' using errcode='PT404',detail='affiliation_unavailable';end if;
    if p_action='sponsor' then
      if p_value is null or p_value not in('founding','organisation') then raise exception 'valid funding source required' using errcode='22023',detail='sponsorship_invalid';end if;
      result:=internal.sponsor_business(p_item,p_note);
      if result->>'sponsor_type' is distinct from p_value
        then raise exception 'the current programme funding changed' using errcode='PT409',detail='programme_inactive';end if;
    else result:=internal.org_update_affiliation(p_item,p_action,p_value);end if;
  elsif p_action='end_sponsorship' then
    if not exists(select 1 from private.organisation_sponsorships s where s.id=p_item and s.organisation_id=p_org)
      then raise exception 'represented sponsorship unavailable' using errcode='PT404',detail='sponsorship_unavailable';end if;
    result:=internal.end_sponsorship(p_item,p_note);
  else raise exception 'valid organisation action required' using errcode='22023',detail='organisation_invalid';end if;
  perform internal.organisation_actor(p_org);return result;
end$$;
create function api.execute_frontend_organisation_action(p_org uuid,p_item uuid,p_action text,p_value text default null,p_note text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.execute_frontend_organisation_action(p_org,p_item,p_action,p_value,p_note)$$;
revoke all on function internal.execute_frontend_organisation_action(uuid,uuid,text,text,text),api.execute_frontend_organisation_action(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.execute_frontend_organisation_action(uuid,uuid,text,text,text),api.execute_frontend_organisation_action(uuid,uuid,text,text,text) to authenticated;

create function internal.get_frontend_organisation_dashboard(p_slug text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();o private.organisations;viewer_role text;result jsonb;
begin
  if p_slug is null or length(p_slug) not between 3 and 60 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    then raise exception 'valid organisation slug required' using errcode='22023',detail='organisation_invalid';end if;
  select o0.* into o from private.organisations o0 join private.organisation_admins a on a.organisation_id=o0.id
    where o0.slug=p_slug and a.account_id=actor;
  if not found then return null;end if;
  perform internal.organisation_actor(o.id);
  select a.role into viewer_role from private.organisation_admins a where a.organisation_id=o.id and a.account_id=actor;
  if viewer_role is null then return null;end if;
  select jsonb_build_object('account_id',actor,'id',o.id,'slug',o.slug,'name',o.name,'viewer_role',viewer_role,
    'programme_status',o.programme_status,'starts_at',o.programme_starts_at,'ends_at',o.programme_ends_at,
    'sponsored_capacity',o.sponsored_capacity,'admin_limit',o.admin_limit,'is_public',o.is_public,
    'affiliation_wording',o.affiliation_wording,
    'applications',(select jsonb_build_object('pending',count(*) filter(where a.status='submitted'),
      'moreInfo',count(*) filter(where a.status='more_info_required'),'approved',count(*) filter(where a.status='approved'),
      'declined',count(*) filter(where a.status='declined')) from private.organisation_applications a where a.organisation_id=o.id),
    'public_contacts',coalesce((select jsonb_agg(jsonb_build_object('application_id',a.id,
      'phone',p.contacts->>'phone','email',p.data->>'email','website',p.data->>'website')
      order by a.created_at desc,a.id)
      from (select x.id,x.post_id,x.created_at from private.organisation_applications x
        where x.organisation_id=o.id and x.status<>'withdrawn'
        order by x.created_at desc,x.id limit 200)a
      join private.public_eligible_posts e on e.id=a.post_id
      join private.post_presentations p on p.post_id=e.id),'[]'::jsonb),
    'affiliated',(select count(*) from private.organisation_affiliations a where a.organisation_id=o.id and a.status='active'),
    'admins',coalesce((select jsonb_agg(jsonb_build_object('user_id',a.account_id,'role',a.role,'display_name',p.display_name)
      order by a.created_at,a.account_id) from private.organisation_admins a left join private.profiles p on p.account_id=a.account_id
      where a.organisation_id=o.id),'[]'::jsonb)
  ) into result;
  perform internal.price_draft_actor();
  if not exists(select 1 from private.organisation_admins a where a.organisation_id=o.id and a.account_id=actor and a.role=viewer_role)
    then return null;end if;
  return result;
end$$;
create function api.get_frontend_organisation_dashboard(p_slug text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_organisation_dashboard(p_slug)$$;
revoke all on function internal.get_frontend_organisation_dashboard(text),api.get_frontend_organisation_dashboard(text) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_organisation_dashboard(text),api.get_frontend_organisation_dashboard(text) to authenticated;
notify pgrst,'reload schema';
commit;
