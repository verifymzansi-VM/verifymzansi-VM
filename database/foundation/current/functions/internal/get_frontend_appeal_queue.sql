-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_appeal_queue(p_appeal uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('appeal:decide');items jsonb;total bigint;
begin
  with eligible as (
    select * from private.frontend_appeals a where (p_appeal is null and a.status='submitted') or a.id=p_appeal
  )
  select (select count(*) from eligible),coalesce(jsonb_agg(jsonb_build_object('id',a.id,'decision_id',a.action_id,'appellant_id',a.appellant_id,
    'reason',a.reason,'kind',a.kind,'status',a.status,'created_at',a.created_at,'reviewer_id',a.reviewer_id,
    'reviewer_rationale',a.reviewer_rationale,'resolved_at',a.resolved_at,'effect_version',x.effect_version,'ends_at',x.ends_at,
    'decision_reason',x.reason,
    'can_resolve',a.status='submitted' and x.id is not null and not coalesce(actor in(a.appellant_id,x.actor_id,x.approver_id,x.reporter_id),false))
    order by a.created_at,a.id),'[]'::jsonb) into total,items
    from (select * from eligible order by created_at,id limit 50)a
    left join private.frontend_appealable_actions x on x.id=a.action_id and x.account_id=a.appellant_id;
  perform internal.staff_actor('appeal:decide');return jsonb_build_object('actor_id',actor,'items',items,'total',total);
end$function$;
alter function internal.get_frontend_appeal_queue(uuid) owner to postgres;
revoke all on function internal.get_frontend_appeal_queue(uuid) from public;
grant execute on function internal.get_frontend_appeal_queue(uuid) to authenticated;
