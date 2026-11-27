-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_post_presentation(p_post uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select jsonb_build_object('data',coalesce((select internal.public_post_presentation_data(p.kind::text,d.data)
        || case when p.kind='business' then jsonb_build_object('business_contact_options',jsonb_build_object(
          'call',internal.business_contact_number(d.data,d.contacts,'call') is not null,
          'whatsapp',internal.business_contact_number(d.data,d.contacts,'whatsapp') is not null)) else '{}'::jsonb end
      from private.post_presentations d join private.posts p on p.id=d.post_id where d.post_id=p_post),'{}'::jsonb),
   'media',coalesce((select jsonb_agg(jsonb_build_object('purpose',r.purpose,'position',r.position,'object_key',m.object_key,
     'width',m.width,'height',m.height) order by r.purpose,r.position)
     from private.post_presentation_media r join private.media_objects m on m.id=r.object_id
     join private.posts p on p.id=r.post_id and p.owner_id=m.owner_id
     where r.post_id=p_post and m.state='ready' and m.kind='image'),'[]'::jsonb));
$function$;
alter function internal.frontend_post_presentation(uuid) owner to postgres;
revoke all on function internal.frontend_post_presentation(uuid) from public;
