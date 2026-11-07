-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_organisation_directory()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.get_frontend_staff_organisation_directory() owner to postgres;
revoke all on function internal.get_frontend_staff_organisation_directory() from public;
grant execute on function internal.get_frontend_staff_organisation_directory() to authenticated;
