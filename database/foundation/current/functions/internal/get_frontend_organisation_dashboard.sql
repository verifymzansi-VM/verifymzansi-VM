-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_organisation_dashboard(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    'affiliated',(select count(*) from private.organisation_affiliations a where a.organisation_id=o.id and a.status='active'),
    'admins',coalesce((select jsonb_agg(jsonb_build_object('user_id',a.account_id,'role',a.role,'display_name',
        case when a.account_id=actor then p.display_name else internal.profile_public_name(p.display_name) end)
      order by a.created_at,a.account_id) from private.organisation_admins a left join private.profiles p on p.account_id=a.account_id
      where a.organisation_id=o.id),'[]'::jsonb)
  ) into result;
  perform internal.price_draft_actor();
  if not exists(select 1 from private.organisation_admins a where a.organisation_id=o.id and a.account_id=actor and a.role=viewer_role)
    then return null;end if;
  return result;
end$function$;
alter function internal.get_frontend_organisation_dashboard(text) owner to postgres;
revoke all on function internal.get_frontend_organisation_dashboard(text) from public;
grant execute on function internal.get_frontend_organisation_dashboard(text) to authenticated;
