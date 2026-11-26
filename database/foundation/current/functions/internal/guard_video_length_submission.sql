-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.guard_video_length_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare limit_seconds integer;bad record;
begin
  if new.status<>'pending_moderation' then return new;end if;
  if tg_op='UPDATE' then
    if old.status='pending_moderation' then return new;end if;
  end if;
  limit_seconds:=case when new.kind='event' then 60 else 120 end;
  select m.duration_ms into bad from private.post_media pm join private.media_objects m on m.id=pm.object_id
    where pm.post_id=new.id and m.kind='video'
      and (m.duration_ms is null or m.duration_ms>=(limit_seconds+1)*1000)
      and not (new.edit_of is not null and exists(select 1 from private.post_media o
        where o.post_id=new.edit_of and o.object_id=pm.object_id))
    order by m.duration_ms desc nulls first limit 1;
  if not found then return new;end if;
  if bad.duration_ms is null then
    raise exception 'upload the video again so its length can be checked' using errcode='22023',detail='video_length_unknown';
  end if;
  raise exception 'the video is longer than this post allows' using errcode='22023',detail='video_too_long',
    hint=format('%s/%s',bad.duration_ms/1000,limit_seconds);
end$function$;
alter function internal.guard_video_length_submission() owner to postgres;
revoke all on function internal.guard_video_length_submission() from public;
