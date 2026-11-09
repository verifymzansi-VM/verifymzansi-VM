-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_public_frontend_business_affiliations(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_post_ids is null or cardinality(p_post_ids)>100
    then raise exception 'at most 100 business ids required' using errcode='22023';end if;
  return (select coalesce(jsonb_agg(q.badge order by q.post_id,q.sponsored desc,q.confirmed_at,q.id),'[]'::jsonb)
    from (select f.post_id,(s.id is not null) sponsored,f.confirmed_at,f.id,jsonb_build_object(
    'business_id',f.post_id,'organisation_id',o.id,'organisation_slug',o.slug,'organisation_name',o.name,
    'logo_object_key',internal.organisation_logo_key(o),'label',internal.affiliation_label(f.affiliation_type,o.affiliation_wording),
    'programme_name',pr.name,'confirmed_at',f.confirmed_at,'sponsored',s.id is not null,
    'sponsorship_label',case when s.id is not null then o.sponsorship_wording||' '||o.name end) badge
    from private.organisation_affiliations f
    join private.organisations o on o.id=f.organisation_id
    join private.public_eligible_posts e on e.id=f.post_id
    join private.posts p on p.id=e.id and p.kind='business'
    left join private.organisation_programmes pr on pr.id=f.programme_id
    left join private.organisation_sponsorships s on s.affiliation_id=f.id and s.status='active'
      and s.sponsor_type='organisation' and s.starts_at<=statement_timestamp() and s.ends_at>statement_timestamp()
    where f.post_id=any(p_post_ids) and f.status='active' and internal.organisation_listed(o)
    order by f.post_id,(s.id is not null) desc,f.confirmed_at,f.id limit 1000)q);
end$function$;
alter function internal.get_public_frontend_business_affiliations(uuid[]) owner to postgres;
revoke all on function internal.get_public_frontend_business_affiliations(uuid[]) from public;
grant execute on function internal.get_public_frontend_business_affiliations(uuid[]) to anon;
grant execute on function internal.get_public_frontend_business_affiliations(uuid[]) to authenticated;
