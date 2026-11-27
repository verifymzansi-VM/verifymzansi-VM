-- Reviewed rollback for updates/20261127044054_public_presentation_display_fields.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. The public card read then
-- returns the whole stored presentation again (except a Market listing's
-- location_address). Emails the update removed are not restored.
-- It refuses (55000) unless internal.frontend_post_presentation has the
-- update's body, then puts back the earlier body byte for byte and drops the
-- two functions the update added.
begin;
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.frontend_post_presentation(uuid)');
  if body is distinct from '9f279565fc4eca46f6b355313a2271a3' then
    raise exception 'rollback precondition: the public presentation fields update is not applied as reviewed (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.frontend_post_presentation(p_post uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select jsonb_build_object('data',coalesce((select case when p.kind='listing' then d.data-'location_address' else d.data end
      from private.post_presentations d join private.posts p on p.id=d.post_id where d.post_id=p_post),'{}'::jsonb),
   'media',coalesce((select jsonb_agg(jsonb_build_object('purpose',r.purpose,'position',r.position,'object_key',m.object_key,
     'width',m.width,'height',m.height) order by r.purpose,r.position)
     from private.post_presentation_media r join private.media_objects m on m.id=r.object_id
     join private.posts p on p.id=r.post_id and p.owner_id=m.owner_id
     where r.post_id=p_post and m.state='ready' and m.kind='image'),'[]'::jsonb)) || coalesce((select jsonb_build_object('business_contacts',d.contacts)
      from private.post_presentations d join private.posts p on p.id=d.post_id
      where d.post_id=p_post and p.kind='business'),'{}'::jsonb);
$function$;
alter function internal.frontend_post_presentation(uuid) owner to postgres;
revoke all on function internal.frontend_post_presentation(uuid) from public;

drop function if exists internal.public_post_presentation_data(text,jsonb);
drop function if exists internal.json_object_keys_only(jsonb,text[]);

commit;
