-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_enforcement()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');now_at timestamptz:=clock_timestamp();result jsonb;
begin
  with active as materialized (
    select x.id,x.decision_id,x.account_id,x.kind,x.reason,x.starts_at,x.ends_at,x.emergency,x.version,
      coalesce(actor in(x.account_id,x.reporter_id,d.proposed_by,d.approved_by),false) as conflicted,p.display_name
      from private.frontend_account_restrictions x join private.decisions d on d.id=x.decision_id
      left join private.profiles p on p.account_id=x.account_id
      where x.lifted_at is null and (x.ends_at is null or x.ends_at>now_at)
    union all
    select d.id,d.id,c.subject_id,'ban','Account restricted after an independent review.',d.approved_at,null,false,null,true,p.display_name
      from private.decisions d join private.evidence_cases c on c.id=d.case_id
      left join private.profiles p on p.account_id=c.subject_id
      where d.action='restrict_account' and d.scope_kind='native' and d.status='approved' and not exists(select 1 from private.frontend_account_restrictions y where y.decision_id=d.id and not y.emergency)
  ), history as (
    select a.id::text id,a.action,r.subject_account_id account_id,a.reason,a.created_at
      from private.frontend_report_action_receipts a join private.reports r on r.id=a.report_id where a.action in('warn','hide') and a.status='applied'
    union all
    select 'restriction:'||x.id,case when x.emergency then 'emergency suspension' else x.kind end,x.account_id,x.reason,x.starts_at
      from private.frontend_account_restrictions x
    union all
    select 'lift:'||x.id,'lift',x.account_id,x.lift_reason,x.lifted_at
      from private.frontend_account_restrictions x where x.lifted_at is not null
    union all
    select 'restriction:'||d.id,'ban',c.subject_id,'Account restricted after an independent review.',d.approved_at
      from private.decisions d join private.evidence_cases c on c.id=d.case_id
      where d.action='restrict_account' and d.scope_kind='native' and d.status='approved' and not exists(select 1 from private.frontend_account_restrictions y where y.decision_id=d.id and not y.emergency)
  ) select jsonb_build_object('actor_id',actor,
    'total',(select count(*) from active),
    'suspensions',(select count(*) from active where kind='suspension'),
    'bans',(select count(*) from active where kind='ban'),
    'emergency',(select count(*) from active where emergency),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc,x.id desc) from
      (select * from active order by starts_at desc,id desc limit 50)x),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from
      (select * from history order by created_at desc,id desc limit 20)x),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('account:restore');return result;
end$function$;
alter function internal.get_frontend_enforcement() owner to postgres;
revoke all on function internal.get_frontend_enforcement() from public;
grant execute on function internal.get_frontend_enforcement() to authenticated;
