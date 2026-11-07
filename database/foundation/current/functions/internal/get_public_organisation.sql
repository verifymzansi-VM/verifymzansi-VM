-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_public_organisation(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('id',o.id,'slug',o.slug,'name',o.name,'organisation_type',o.organisation_type,
    'description',o.description,'programme_description',o.programme_description,'service_area',o.service_area,
    'province',o.province_id,'website',o.website,'public_email',o.public_email,'public_phone',o.public_phone,
    'logo_object_key',internal.organisation_logo_key(o),'programme_status',o.programme_status,
    'accepting_applications',o.accepting_applications and o.programme_status not in('suspended','ended'),
    'affiliation_wording',o.affiliation_wording,
    'live_businesses',(select count(distinct f.post_id) from private.organisation_affiliations f
      join private.public_eligible_posts e on e.id=f.post_id where f.organisation_id=o.id and f.status='active'),
    'programmes',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'slug',p.slug,'name',p.name,
      'description',p.description) order by p.name) from private.organisation_programmes p
      where p.organisation_id=o.id and p.active),'[]'))
  from private.organisations o where o.slug=p_slug and internal.organisation_listed(o);
$function$;
alter function internal.get_public_organisation(text) owner to postgres;
revoke all on function internal.get_public_organisation(text) from public;
grant execute on function internal.get_public_organisation(text) to anon;
grant execute on function internal.get_public_organisation(text) to authenticated;
