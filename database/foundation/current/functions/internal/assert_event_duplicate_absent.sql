-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_event_duplicate_absent(p_post_id uuid, p_staff boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare target private.posts; logical_id uuid; core jsonb; duplicate boolean; actor uuid;
begin
  if p_staff then actor:=internal.staff_actor('post:moderate');
  else actor:=internal.price_draft_actor(); end if;
  if p_staff is null then raise exception 'invalid internal authority context' using errcode='22023'; end if;
  -- Callers already hold original -> copy -> media locks. Never lock competitors.
  select * into target from private.posts p where p.id=p_post_id;
  if target.id is null or target.kind<>'event' then raise exception 'event not found' using errcode='22023'; end if;
  if (not p_staff and actor<>target.owner_id) or (p_staff and actor=target.owner_id) then
    raise exception 'event authority denied' using errcode='42501';
  end if;
  logical_id:=coalesce(target.edit_of,target.id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target.owner_id::text,909));
  -- Recheck before data-dependent denials, not only on the successful return path.
  if p_staff then perform internal.staff_actor('post:moderate');
  else perform internal.price_draft_actor(); end if;
  core:=internal.event_duplicate_core(target.id);
  select exists(select 1 from private.posts p
    where p.owner_id=target.owner_id and p.kind='event' and p.status in('pending_moderation','live')
      and coalesce(p.edit_of,p.id)<>logical_id
      and (p.edit_of is null or (p.status='pending_moderation' and exists(
        select 1 from private.posts o join private.event_details e on e.post_id=o.id
        where o.id=p.edit_of and o.status='live' and o.visible_until>clock_timestamp() and e.ends_at>clock_timestamp())))
      and internal.event_duplicate_core(p.id)=core) into duplicate;
  if p_staff then perform internal.staff_actor('post:moderate');
  else perform internal.price_draft_actor(); end if;
  if core is null then raise exception 'event detail not found' using errcode='22023'; end if;
  if duplicate then
    raise exception 'a matching event is already pending or live on your account'
      using errcode='PT409',detail='duplicate_event';
  end if;
end;
$function$;
alter function internal.assert_event_duplicate_absent(uuid,boolean) owner to postgres;
revoke all on function internal.assert_event_duplicate_absent(uuid,boolean) from public;
