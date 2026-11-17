-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_frontend_post_presentation(p_post uuid, p_data jsonb, p_contacts jsonb, p_media jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare post private.posts; selected_slug text; original uuid;
begin
  select * into post from private.posts where id=p_post;
  if post.id is null or jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_contacts) is distinct from 'object'
    or jsonb_typeof(p_media) is distinct from 'array' or jsonb_array_length(p_media)>12 then
    raise exception 'post presentation unavailable' using errcode='22023'; end if;
  -- Server-only staging excludes private account fields and contact numbers.
  if p_data ?| array['owner_id','user_id','account_id','role','capabilities','verified','identity_verified','phone','whatsapp','status','entitlement_id'] then
    raise exception 'non-presentation field refused' using errcode='22023'; end if;
  perform m.id from private.media_objects m where m.id in(select (i->>'object_id')::uuid from jsonb_array_elements(p_media) i) order by m.id for update;
  if exists(select 1 from jsonb_array_elements(p_media) i left join private.media_objects m on m.id=(i->>'object_id')::uuid
    where m.id is null or m.owner_id<>post.owner_id or m.state<>'ready' or m.kind<>'image') then
    raise exception 'presentation media must be your finished image uploads' using errcode='22023'; end if;
  selected_slug:=p_data->>'slug'; original:=coalesce(post.edit_of,post.id);
  if selected_slug is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(selected_slug,2811));
    insert into private.post_slugs(slug,post_id) values(selected_slug,original) on conflict(slug) do nothing;
    if not exists(select 1 from private.post_slugs s where s.slug=selected_slug and s.post_id=original) then
      raise exception 'business address name already in use' using errcode='PT409',detail='slug_conflict'; end if;
  end if;
  insert into private.post_presentations(post_id,data,contacts) values(post.id,p_data,p_contacts)
    on conflict(post_id) do update set data=excluded.data,contacts=excluded.contacts;
  delete from private.post_presentation_media where post_id=post.id;
  insert into private.post_presentation_media(post_id,object_id,purpose,position)
    select post.id,(i->>'object_id')::uuid,i->>'purpose',(i->>'position')::smallint from jsonb_array_elements(p_media) i;
end$function$;
alter function internal.save_frontend_post_presentation(uuid,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function internal.save_frontend_post_presentation(uuid,jsonb,jsonb,jsonb) from public;
