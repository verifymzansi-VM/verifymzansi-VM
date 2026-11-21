-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_public_storefront(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_business uuid := internal.storefront_of_post(p_post_id);
  v_package uuid := internal.storefront_package(v_business);
  result jsonb;
begin
  if v_package is null then return null; end if;
  -- The same listings as search with 'storefront' (publicly visible now).
  with stock as materialized (
    select d.category_key, d.province_id, d.city_id, ld.attributes->>'make' as make
    from private.post_activations a
    join private.entitlements c on c.id = a.entitlement_id and c.package_id = v_package
    join private.post_search_documents d on d.post_id = a.post_id and d.kind = 'listing'
    join private.listing_details ld on ld.post_id = d.post_id
    where a.released_at is null and d.is_visible and d.published_at <= statement_timestamp()
      and (d.visible_until is null or d.visible_until > statement_timestamp())
      and exists(select 1 from private.public_eligible_posts e where e.id = d.post_id)
  )
  select jsonb_build_object(
    'business_id', v_business,
    'business_name', (select p.title from private.posts p where p.id = v_business),
    'listings', (select count(*) from stock),
    'categories', coalesce((select jsonb_object_agg(x.category_key, x.n)
      from (select s.category_key, count(*) as n from stock s group by s.category_key) x), '{}'::jsonb),
    'makes', coalesce((select jsonb_agg(x.make order by lower(x.make))
      from (select distinct on (lower(s.make)) s.make from stock s
        where s.category_key = 'vehicles' and nullif(btrim(s.make), '') is not null
        order by lower(s.make), s.make collate "C") x), '[]'::jsonb),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('province', x.province_id, 'city', x.city_id)
        order by x.province_id, x.city_id)
      from (select distinct s.province_id, s.city_id from stock s
        where s.category_key = 'property' and s.city_id is not null) x), '[]'::jsonb))
  into result;
  return result;
end;
$function$;
alter function internal.get_public_storefront(uuid) owner to postgres;
revoke all on function internal.get_public_storefront(uuid) from public;
grant execute on function internal.get_public_storefront(uuid) to anon;
grant execute on function internal.get_public_storefront(uuid) to authenticated;
