-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.my_organisation_links()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();
begin
  return jsonb_build_object(
    'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'organisation_name',o.name,
        'organisation_slug',o.slug,'post_id',a.post_id,'post_title',p.title,'status',a.status,
        'info_request',a.info_request,'created_at',a.created_at,'updated_at',a.updated_at) order by a.created_at desc)
      from (select * from private.organisation_applications x where x.applicant_id=actor
        order by x.created_at desc limit 100) a
      join private.organisations o on o.id=a.organisation_id join private.posts p on p.id=a.post_id),'[]'),
    'affiliations',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'organisation_name',o.name,
        'organisation_slug',o.slug,'post_id',f.post_id,'post_title',p.title,
        'label',internal.affiliation_label(f.affiliation_type,o.affiliation_wording),'confirmed_at',f.confirmed_at)
        order by f.confirmed_at desc)
      from private.organisation_affiliations f join private.posts p on p.id=f.post_id
      join private.organisations o on o.id=f.organisation_id
      where p.owner_id=actor and f.status='active'),'[]'),
    'administers',coalesce((select jsonb_agg(jsonb_build_object('organisation_id',o.id,'organisation_name',o.name,
        'organisation_slug',o.slug,'role',x.role) order by o.name)
      from private.organisation_admins x join private.organisations o on o.id=x.organisation_id
      where x.account_id=actor),'[]'));
end;
$function$;
alter function internal.my_organisation_links() owner to postgres;
revoke all on function internal.my_organisation_links() from public;
grant execute on function internal.my_organisation_links() to authenticated;
