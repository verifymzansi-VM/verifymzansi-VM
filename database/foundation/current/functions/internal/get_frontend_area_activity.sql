-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_area_activity(p_area text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');answer jsonb;day_start timestamptz:=date_trunc('day',statement_timestamp() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
begin
  if p_area is not null and p_area not in('market','business','tourism_events') or p_limit is null or p_limit not between 1 and 100 then raise exception 'bounded program activity required' using errcode='22023';end if;
  with events as materialized(
    select 'moderation:'||m.id::text id,m.staff_id actor_id,p.id target_id,p.kind target_type,p.area,
      'content_'||m.decision action,m.decision action_kind,m.decided_at created_at
      from private.moderation_log m join private.posts p on p.id=m.post_id where p_area is null or p.area=p_area
    union all select 'report:'||r.id::text,r.resolved_by,r.id,'report',coalesce(r.frontend_area,p.area),
      'report_'||r.status,case r.status when 'dismissed' then 'dismiss' else 'resolve' end,r.resolved_at
      from private.reports r left join private.posts p on p.id=r.post_id where r.resolved_at is not null
      and (p_area is null or coalesce(r.frontend_area,p.area)=p_area)
  ), visible as(select * from events order by created_at desc,id desc limit p_limit), counts as(
    select action_kind,count(*) amount from events where created_at>=day_start and created_at<=statement_timestamp() group by action_kind
  )
  select jsonb_build_object('account_id',actor,'area',p_area,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'target_id',v.target_id,'target_type',case v.target_type when 'event' then 'promotion' else v.target_type end,'area',v.area,'action',v.action,'created_at',v.created_at) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
    'today',coalesce((select jsonb_object_agg(c.action_kind,c.amount) from counts c),'{}'::jsonb)) into answer;
  perform internal.staff_actor('queue:view');return answer;
end$function$;
alter function internal.get_frontend_area_activity(text,integer) owner to postgres;
revoke all on function internal.get_frontend_area_activity(text,integer) from public;
grant execute on function internal.get_frontend_area_activity(text,integer) to authenticated;
