-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_seen_queue(p_tab text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');answer jsonb;
begin
  if p_tab is null or p_tab not in('review','representatives','visits','conflicts','renewals','exceptions','waiting','decided')
    then raise exception 'valid business review queue required' using errcode='22023';end if;
  with cases as (
    select x.*,p.title as business_name,pr.display_name as owner_name,
      case when x.status='info_requested' then 'waiting' when x.status='pending' then 'visits' else 'decided' end tab,
      e.claimed_by=actor and e.claim_expires_at>clock_timestamp() as mine
    from private.frontend_business_checks x join private.posts p on p.id=x.business_id
    join private.evidence_cases e on e.id=x.id left join private.profiles pr on pr.account_id=x.owner_id
    where x.kind='seen' and x.owner_id<>actor
  )
  select jsonb_build_object('actor_id',actor,
    'counts',jsonb_build_object('visits',(select count(*) from cases where tab='visits'),
      'waiting',(select count(*) from cases where tab='waiting'),'decided',null,
      'review',0,'representatives',0,'conflicts',0,'renewals',0,'exceptions',0),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'kind','seen','route',null,'status',x.status,
      'businessId',x.business_id,'businessName',coalesce(x.business_name,'Business'),'ownerName',coalesce(x.owner_name,'Member'),
      'registrationNumber',null,'red',0,'amber',0,'createdAt',x.created_at,'updatedAt',x.updated_at,
      'exceptionPending',false,'conflict',false,'renewal',false) order by x.sort_at,x.id)
      from (select c.*,case when p_tab='decided' then -extract(epoch from c.decided_at) else extract(epoch from c.created_at) end sort_at
        from cases c where c.tab=p_tab or (p_tab<>'decided' and c.tab<>'decided' and c.mine)
        order by sort_at,id limit 200)x),'[]'::jsonb)) into answer;
  perform internal.staff_actor('queue:view');return answer;
end$function$;
alter function internal.get_frontend_seen_queue(text) owner to postgres;
revoke all on function internal.get_frontend_seen_queue(text) from public;
grant execute on function internal.get_frontend_seen_queue(text) to authenticated;
