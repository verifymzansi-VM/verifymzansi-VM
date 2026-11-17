-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.public_programme_showcases(p_placement text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_placement is null or p_placement not in('home','business','tourism','market') then
    raise exception 'unknown placement' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'organisation_slug',v.slug,
      'organisation_name',v.name,'cards',v.cards) order by v.display_order,v.id),'[]')
    from (select s.id,s.title,s.display_order,o.slug,o.name,c.cards
      from private.programme_showcases s
      join private.organisations o on o.id=s.organisation_id
      cross join lateral (select jsonb_agg(jsonb_build_object('post_id',k.id,'title',k.title,'city',k.city_id,
          'cover_object_key',k.object_key,'sponsored',k.sponsored) order by k.sponsored desc,k.title,k.id) cards,
          count(*) n
        from (select q.* from (select p.id,p.title,p.city_id,m.object_key,
              exists(select 1 from private.organisation_sponsorships x where x.post_id=p.id and x.organisation_id=o.id
                and x.status='active' and x.starts_at<=statement_timestamp()
                and x.ends_at>statement_timestamp()) sponsored
            from private.organisation_affiliations f
            join private.posts p on p.id=f.post_id
            join private.public_eligible_posts e on e.id=p.id
            join private.post_search_documents d on d.post_id=p.id and d.is_visible
              and (d.visible_until is null or d.visible_until>statement_timestamp())
            join private.post_media pm on pm.post_id=p.id and pm.purpose='cover'
            join private.media_objects m on m.id=pm.object_id and m.state='ready' and m.kind='image'
            where f.organisation_id=o.id and f.status='active'
              and (s.programme_id is null or f.programme_id=s.programme_id)
              and (s.province_id is null or p.province_id=s.province_id)
              and (s.city_id is null or p.city_id=s.city_id)) q
          where not s.sponsored_only or q.sponsored
          order by q.sponsored desc,q.title,q.id limit s.max_cards) k) c
      where s.placement=p_placement and s.enabled and s.starts_at<=statement_timestamp()
        and s.ends_at>statement_timestamp() and internal.organisation_listed(o)
        and (s.programme_id is null or exists(select 1 from private.organisation_programmes g
          where g.id=s.programme_id and g.active))
        and c.n>=3
      order by s.display_order,s.id limit 2) v);
end;
$function$;
alter function internal.public_programme_showcases(text) owner to postgres;
revoke all on function internal.public_programme_showcases(text) from public;
grant execute on function internal.public_programme_showcases(text) to anon;
grant execute on function internal.public_programme_showcases(text) to authenticated;
