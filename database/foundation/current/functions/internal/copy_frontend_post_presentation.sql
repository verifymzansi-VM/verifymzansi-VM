-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.copy_frontend_post_presentation(p_from uuid, p_to uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$begin
  if not exists(select 1 from private.posts a join private.posts b on b.owner_id=a.owner_id where a.id=p_from and b.id=p_to and (a.edit_of=b.id or b.edit_of=a.id)) then
    raise exception 'owned edit relationship required' using errcode='23514'; end if;
  delete from private.post_presentations where post_id=p_to;
  insert into private.post_presentations select p_to,data,contacts from private.post_presentations where post_id=p_from;
  delete from private.post_presentation_media where post_id=p_to;
  insert into private.post_presentation_media select p_to,object_id,purpose,position from private.post_presentation_media where post_id=p_from;
end$function$;
alter function internal.copy_frontend_post_presentation(uuid,uuid) owner to postgres;
revoke all on function internal.copy_frontend_post_presentation(uuid,uuid) from public;
