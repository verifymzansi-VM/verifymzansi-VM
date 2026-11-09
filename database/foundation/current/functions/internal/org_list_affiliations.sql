-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.org_list_affiliations(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.organisation_actor(p_org);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'post_id',f.post_id,'business_name',p.title,
      'category',p.category_key,'province',p.province_id,'city',p.city_id,
      'live',exists(select 1 from private.public_eligible_posts e where e.id=f.post_id),
      'affiliation_type',f.affiliation_type,'programme_name',g.name,'confirmed_at',f.confirmed_at)
      order by f.confirmed_at desc),'[]')
    from (select * from private.organisation_affiliations x where x.organisation_id=p_org and x.status='active'
      order by x.confirmed_at desc limit 500) f
    join private.posts p on p.id=f.post_id
    left join private.organisation_programmes g on g.id=f.programme_id);
end;
$function$;
alter function internal.org_list_affiliations(uuid) owner to postgres;
revoke all on function internal.org_list_affiliations(uuid) from public;
grant execute on function internal.org_list_affiliations(uuid) to authenticated;
