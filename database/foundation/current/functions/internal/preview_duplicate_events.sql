-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.preview_duplicate_events(p_post_a uuid, p_post_b uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('event:flag_duplicate'); a uuid; b uuid;
  view_a jsonb; view_b jsonb; flag uuid;
begin
  if p_post_a is null or p_post_b is null or p_post_a=p_post_b then
    raise exception 'choose two different event posts' using errcode='22023';
  end if;
  a:=least(p_post_a,p_post_b); b:=greatest(p_post_a,p_post_b);
  perform internal.lock_duplicate_event_pair(a,b);
  actor:=internal.staff_actor('event:flag_duplicate');
  view_a:=internal.duplicate_public_event_view(a);
  view_b:=internal.duplicate_public_event_view(b);
  perform internal.staff_actor('event:flag_duplicate');
  if view_a is null or view_b is null then
    raise exception 'event pair is unavailable' using errcode='22023';
  end if;
  if exists(select 1 from private.posts p where p.id in(a,b) and p.owner_id=actor) then
    raise exception 'you cannot flag your own event' using errcode='42501';
  end if;
  select r.id into flag from private.reports r where r.report_origin='staff'
    and r.status='open' and r.duplicate_post_a=a and r.duplicate_post_b=b;
  perform internal.staff_actor('event:flag_duplicate');
  return jsonb_build_object('post_a',view_a,'post_b',view_b,'open_flag_id',flag);
end;
$function$;
alter function internal.preview_duplicate_events(uuid,uuid) owner to postgres;
revoke all on function internal.preview_duplicate_events(uuid,uuid) from public;
grant execute on function internal.preview_duplicate_events(uuid,uuid) to authenticated;
