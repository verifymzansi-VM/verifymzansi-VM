-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.guard_video_length_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare limit_seconds integer;longest integer;
begin
  if new.status<>'pending_moderation' then return new;end if;
  if tg_op='UPDATE' then
    if old.status='pending_moderation' then return new;end if;
  end if;
  limit_seconds:=case when new.kind='event' then 60 else 120 end;
  select max(m.duration_ms) into longest from private.post_media pm join private.media_objects m on m.id=pm.object_id
    where pm.post_id=new.id and m.kind='video';
  if longest is null or longest<(limit_seconds+1)*1000 then return new;end if;
  raise exception 'the video is longer than this post allows' using errcode='22023',detail='video_too_long',
    hint=format('%s/%s',longest/1000,limit_seconds);
end$function$;
alter function internal.guard_video_length_submission() owner to postgres;
revoke all on function internal.guard_video_length_submission() from public;
