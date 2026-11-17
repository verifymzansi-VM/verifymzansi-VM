-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.public_post_affiliations(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_post_ids is null or cardinality(p_post_ids) not between 1 and 100 then
    raise exception 'between 1 and 100 post ids required' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('post_id',f.post_id,'organisation_slug',o.slug,
      'organisation_name',o.name,'logo_object_key',internal.organisation_logo_key(o),
      'label',internal.affiliation_label(f.affiliation_type,o.affiliation_wording),'programme_name',pr.name,
      'confirmed_at',f.confirmed_at) order by f.post_id,f.confirmed_at),'[]')
    from private.organisation_affiliations f
    join private.organisations o on o.id=f.organisation_id
    join private.public_eligible_posts e on e.id=f.post_id
    left join private.organisation_programmes pr on pr.id=f.programme_id
    where f.post_id=any(p_post_ids) and f.status='active' and internal.organisation_listed(o));
end;
$function$;
alter function internal.public_post_affiliations(uuid[]) owner to postgres;
revoke all on function internal.public_post_affiliations(uuid[]) from public;
grant execute on function internal.public_post_affiliations(uuid[]) to anon;
grant execute on function internal.public_post_affiliations(uuid[]) to authenticated;
