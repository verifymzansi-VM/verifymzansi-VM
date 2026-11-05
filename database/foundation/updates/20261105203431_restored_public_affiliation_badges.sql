-- Public card and detail contract. Only an actual organisation-funded place
-- is presented as paid support from the organisation; a founding place is not.
begin;
create function internal.get_public_frontend_business_affiliations(p_post_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
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
end$$;
create function api.get_public_frontend_business_affiliations(p_post_ids uuid[])
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.get_public_frontend_business_affiliations(p_post_ids)
$$;
revoke all on function internal.get_public_frontend_business_affiliations(uuid[]),api.get_public_frontend_business_affiliations(uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.get_public_frontend_business_affiliations(uuid[]),api.get_public_frontend_business_affiliations(uuid[]) to anon,authenticated;
notify pgrst,'reload schema';
commit;
