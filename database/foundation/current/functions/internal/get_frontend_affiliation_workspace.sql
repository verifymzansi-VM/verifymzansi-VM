-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_affiliation_workspace(p_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.get_frontend_affiliation_workspace(text) owner to postgres;
revoke all on function internal.get_frontend_affiliation_workspace(text) from public;
grant execute on function internal.get_frontend_affiliation_workspace(text) to authenticated;
