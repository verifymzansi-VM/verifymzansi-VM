-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_frontend_decisions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.frontend_self_review_actor();result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('decisionId',x.id,'kind',x.kind,'reason',x.reason,'startsAt',x.starts_at,'endsAt',x.ends_at,'active',x.active,
    'appealable',x.appealable and a.id is null,'appeal',case when a.id is not null then
      jsonb_build_object('id',a.id,'status',a.status,'outcome',a.reviewer_rationale,'resolvedAt',a.resolved_at) end)
    order by x.starts_at desc,x.id desc),'[]'::jsonb) into result
    from (select * from private.frontend_appealable_actions where account_id=actor order by starts_at desc,id desc limit 100)x
    left join private.frontend_appeals a on a.action_id=x.id and a.appellant_id=actor;
  perform internal.frontend_self_review_actor();return jsonb_build_object('account_id',actor,'items',result);
end$function$;
alter function internal.get_my_frontend_decisions() owner to postgres;
revoke all on function internal.get_my_frontend_decisions() from public;
grant execute on function internal.get_my_frontend_decisions() to authenticated;
