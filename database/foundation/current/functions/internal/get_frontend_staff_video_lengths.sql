-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_video_lengths(p_posts uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');result jsonb;
begin
  if p_posts is null or cardinality(p_posts) not between 1 and 50 or array_ndims(p_posts)<>1
    or array_position(p_posts,null) is not null then
    raise exception 'bounded post list required' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('post_id',p.id,'duration_ms',m.duration_ms)
      order by p.id,pm.purpose,pm.position),'[]'::jsonb) into result
    from private.posts p
    join private.queue_claims q on q.post_id=p.id and q.claimed_by=actor and q.claim_expires_at>clock_timestamp()
    join private.post_media pm on pm.post_id=p.id
    join private.media_objects m on m.id=pm.object_id and m.kind='video'
    where p.id=any(p_posts) and p.status='pending_moderation';
  return result;
end$function$;
alter function internal.get_frontend_staff_video_lengths(uuid[]) owner to postgres;
revoke all on function internal.get_frontend_staff_video_lengths(uuid[]) from public;
grant execute on function internal.get_frontend_staff_video_lengths(uuid[]) to authenticated;
