-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_report_queue(p_area text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.get_frontend_report_queue(text) owner to postgres;
revoke all on function internal.get_frontend_report_queue(text) from public;
grant execute on function internal.get_frontend_report_queue(text) to authenticated;
