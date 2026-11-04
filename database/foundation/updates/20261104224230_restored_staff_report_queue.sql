-- Closed report summaries for the selected queue. Private descriptions and
-- exact action fences require the caller's own live native claim.
begin;
alter table private.reports add column revision integer not null default 1 check(revision>0),
  add column frontend_area text check(frontend_area is null or frontend_area in('market','business','tourism_events'));
create index reports_frontend_area_idx on private.reports(frontend_area,status,created_at);
create function internal.frontend_report_record_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op='INSERT' then
    select p.area into new.frontend_area from private.posts p where p.id=new.post_id;
    if new.revision<>1 then raise exception 'initial report revision required' using errcode='22023';end if;
  else
    if new.revision<>old.revision or new.frontend_area is distinct from old.frontend_area then raise exception 'report metadata is derived' using errcode='22023';end if;
    if to_jsonb(new)-'revision' is distinct from to_jsonb(old)-'revision' then
      if old.revision=2147483647 then raise exception 'report revision exhausted' using errcode='PT409';end if;
      new.revision:=old.revision+1;
    end if;
  end if;
  return new;
end$$;
revoke all on function internal.frontend_report_record_guard() from public,anon,authenticated,service_role;
create trigger frontend_report_record_guard before insert or update on private.reports for each row execute function internal.frontend_report_record_guard();

create function internal.get_frontend_report_queue(p_area text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view');answer jsonb;
begin
  if p_area is not null and p_area not in('market','business','tourism_events') then raise exception 'valid report program required' using errcode='22023';end if;
  with ready as materialized(
    select r.*,p.kind,coalesce(r.frontend_area,p.area) represented_area,
      q.claimed_by,q.claim_generation,q.claim_nonce,q.claim_expires_at,q.claimed_at,
      coalesce(r.status='open' and q.claim_expires_at>clock_timestamp() and q.claimed_by is not null,false) active,
      coalesce(r.status='open' and q.claim_expires_at>clock_timestamp() and q.claimed_by=actor,false) mine
    from private.reports r left join private.posts p on p.id=r.post_id left join private.queue_claims q on q.report_id=r.id
    where r.subject_account_id<>actor and r.reporter_id is distinct from actor
      and (p_area is null or coalesce(r.frontend_area,p.area)=p_area)
  ), ordered as(
    select r.*,case when r.status<>'open' then 'closed' when r.active then 'active' else 'open' end stage,
      row_number() over(partition by case when r.status<>'open' then 'closed' when r.active then 'active' else 'open' end
        order by case when r.status='open' and r.severity='high' then 0 else 1 end,
          case when r.status='open' then r.created_at end,r.resolved_at desc,r.id) n from ready r
  ), selected as materialized(
    select r.*,case when r.mine then internal.staff_review_report(r.id,r.claim_generation::text,r.claim_nonce) end review
    from ordered r where r.n<=case when r.stage='closed' then 50 else 200 end or r.mine
  )
  select jsonb_build_object('account_id',actor,'open_total',(select count(*) from ready where status='open'),
    'my_claims',(select count(*) from ready where mine),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'target_id',r.post_id,'target_type',case r.kind when 'event' then 'promotion' else coalesce(r.kind,'content') end,
      'area',r.represented_area,'category',r.category,'selected_reason',r.frontend_reason,'severity',r.severity,
      'status',case when r.stage='active' then 'in_progress' else r.status end,
      'description',r.review->>'description','created_at',r.created_at,'updated_at',coalesce(r.resolved_at,r.claimed_at,r.created_at),
      'claim',case when r.active then jsonb_build_object('mine',r.mine,'holder_name',case when r.mine then 'you' else 'another moderator' end,'expires_at',r.claim_expires_at) end,
      'foundation',case when r.mine then jsonb_build_object('expectedRevision',r.revision,'claimGeneration',r.claim_generation::text,'claimNonce',r.claim_nonce) end
    ) order by case r.stage when 'open' then 0 when 'active' then 1 else 2 end,r.n,r.id) from selected r),'[]'::jsonb)) into answer;
  perform internal.staff_actor('queue:view');return answer;
end$$;
revoke all on function internal.get_frontend_report_queue(text) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_report_queue(text) to authenticated;
create function api.get_frontend_report_queue(p_area text default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_report_queue(p_area)$$;
revoke all on function api.get_frontend_report_queue(text) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_report_queue(text) to authenticated;

create function internal.get_frontend_area_activity(p_area text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
end$$;
revoke all on function internal.get_frontend_area_activity(text,integer) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_area_activity(text,integer) to authenticated;
create function api.get_frontend_area_activity(p_area text default null,p_limit integer default 20) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_area_activity(p_area,p_limit)$$;
revoke all on function api.get_frontend_area_activity(text,integer) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_area_activity(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
