-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.public_organisation_directory()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  with live as (
    select f.organisation_id,count(distinct f.post_id)::integer n from private.organisation_affiliations f
    join private.public_eligible_posts e on e.id=f.post_id where f.status='active' group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('slug',o.slug,'name',o.name,'organisation_type',o.organisation_type,
      'service_area',o.service_area,'province',o.province_id,'logo_object_key',internal.organisation_logo_key(o),
      'programme_status',o.programme_status,'live_businesses',coalesce(l.n,0),
      'accepting_applications',o.accepting_applications,
      'on_strip',o.show_on_strip and internal.organisation_logo_key(o) is not null and coalesce(l.n,0)>=5,
      'on_home',o.show_on_home and internal.organisation_logo_key(o) is not null and coalesce(l.n,0)>=5)
    order by case o.programme_status when 'active_paid' then 0 when 'founding_trial' then 1 else 2 end,o.display_order,o.name),'[]')
  from (select * from private.organisations x where internal.organisation_listed(x)
    order by x.display_order,x.name limit 200) o
  left join live l on l.organisation_id=o.id;
$function$;
alter function internal.public_organisation_directory() owner to postgres;
revoke all on function internal.public_organisation_directory() from public;
grant execute on function internal.public_organisation_directory() to anon;
grant execute on function internal.public_organisation_directory() to authenticated;
