-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.apply_frontend_registered_office(p_business uuid, p_owner uuid, p_office jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare target_city text;target_province text;city_label text;street_address text;
begin
  if p_office is null or p_office->>'city' is null or p_office->>'province' is null then return;end if;
  select c.id,c.province_id,c.label into target_city,target_province,city_label
    from private.cities c join private.provinces p on p.id=c.province_id
    where lower(c.label)=lower(p_office->>'city') and lower(p.label)=lower(p_office->>'province') order by c.id limit 1;
  if target_city is null then return;end if;
  select concat_ws(', ',nullif(string_agg(x.value,', ' order by x.n),''),nullif(p_office->>'suburb',''),nullif(p_office->>'postalCode',''))
    into street_address from jsonb_array_elements_text(coalesce(p_office->'streetLines','[]'::jsonb)) with ordinality x(value,n);
  update private.posts set province_id=target_province,city_id=target_city,
    locality_label=city_label,revision=revision+1,content_updated_at=clock_timestamp()
    where id=p_business and owner_id=p_owner and kind='business' and revision<2147483647;
  if not found then raise exception 'business location changed' using errcode='PT409';end if;
  if length(street_address) between 1 and 500 then
    insert into private.post_presentations(post_id,data) values(p_business,jsonb_build_object('location_address',street_address))
      on conflict(post_id) do update set data=private.post_presentations.data||excluded.data;
  end if;
  perform internal.write_post_projection(p_business);
end$function$;
alter function internal.apply_frontend_registered_office(uuid,uuid,jsonb) owner to postgres;
revoke all on function internal.apply_frontend_registered_office(uuid,uuid,jsonb) from public;
