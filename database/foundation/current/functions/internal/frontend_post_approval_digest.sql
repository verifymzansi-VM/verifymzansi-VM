-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_post_approval_digest(p_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select encode(sha256(convert_to(jsonb_build_object(
   'post',to_jsonb(p)-array['status','status_reason','revision','published_at','visible_until','submitted_at','content_updated_at','status_changed_at','ended_at','deletes_at'],
   'listing',(select to_jsonb(d) from private.listing_details d where d.post_id=p.id),
   'business',(select to_jsonb(d) from private.business_details d where d.post_id=p.id),
   'event',(select to_jsonb(d) from private.event_details d where d.post_id=p.id),
   'contacts',(select to_jsonb(c) from private.post_contacts c where c.post_id=p.id),
   'media',coalesce((select jsonb_agg(to_jsonb(m) order by purpose,position) from private.post_media m where m.post_id=p.id),'[]'::jsonb),
   'presentation',(select to_jsonb(d) from private.post_presentations d where d.post_id=p.id),
   'presentation_media',coalesce((select jsonb_agg(to_jsonb(m) order by purpose,position) from private.post_presentation_media m where m.post_id=p.id),'[]'::jsonb)
 )::text,'UTF8')),'hex') from private.posts p where p.id=p_id;
$function$;
alter function internal.frontend_post_approval_digest(uuid) owner to postgres;
revoke all on function internal.frontend_post_approval_digest(uuid) from public;
