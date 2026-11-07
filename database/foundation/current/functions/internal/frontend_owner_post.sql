-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_owner_post(p_post uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select jsonb_build_object('id',p.id,'kind',p.kind,'area',p.area,'category',p.category_key,'activity',p.activity_key,
   'status',p.status,'status_reason',p.status_reason,'revision',p.revision,'edit_of',p.edit_of,
   'created_at',p.created_at,'updated_at',p.content_updated_at,'published_at',p.published_at,'expires_at',case when p.status='pending_moderation' then (select f.funded_until from internal.post_funding(p.id) f) else coalesce(p.visible_until,(select f.funded_until from internal.post_funding(p.id) f)) end,
   'content',jsonb_build_object('title',p.title,'description',p.description,'province_id',p.province_id,'city_id',p.city_id,'locality_label',p.locality_label),
   'listing',case when p.kind='listing' then (select to_jsonb(d)-array['post_id','post_kind'] from private.listing_details d where d.post_id=p.id) end,
   'business_type',(select d.business_type from private.business_details d where d.post_id=p.id),
   'event_window',(select jsonb_build_object('starts_at',e.starts_at,'ends_at',e.ends_at,'timezone',e.timezone) from private.event_details e where e.post_id=p.id),
   'contact_channels',(select channels from private.post_contacts c where c.post_id=p.id),
   'media',coalesce((select jsonb_agg(jsonb_build_object('object_id',m.id,'object_key',m.object_key,'kind',m.kind,'state',m.state,
     'purpose',r.purpose,'position',r.position,'width',m.width,'height',m.height,'focal_x',r.focal_x,'focal_y',r.focal_y) order by r.purpose,r.position)
     from private.post_media r join private.media_objects m on m.id=r.object_id and m.owner_id=p.owner_id where r.post_id=p.id),'[]'::jsonb),
   'frontend',jsonb_set(internal.frontend_post_presentation(p.id),'{data}',coalesce((select data from private.post_presentations where post_id=p.id),'{}'::jsonb)),
   'contacts',coalesce((select contacts from private.post_presentations where post_id=p.id),'{}'::jsonb),
   'pending_edit',(select jsonb_build_object('id',e.id,'status',e.status,'revision',e.revision) from private.posts e where e.edit_of=p.id and e.owner_id=p_actor))
 from private.posts p where p.id=p_post and p.owner_id=p_actor;
$function$;
alter function internal.frontend_owner_post(uuid,uuid) owner to postgres;
revoke all on function internal.frontend_owner_post(uuid,uuid) from public;
