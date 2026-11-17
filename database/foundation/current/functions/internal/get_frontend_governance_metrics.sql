-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_governance_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('decision:approve');answer jsonb;
begin
  select jsonb_build_object('account_id',actor,'total',count(*),'approved',count(*) filter(where d.status='approved'),
    'rejected',count(*) filter(where d.status='withdrawn' and exists(select 1 from private.frontend_governance_events e where e.decision_id=d.id and e.action='reject')),
    'overridden',count(*) filter(where d.status='approved' and d.action='approve_override')) into answer from private.decisions d;
  perform internal.staff_actor('decision:approve');return answer;
end$function$;
alter function internal.get_frontend_governance_metrics() owner to postgres;
revoke all on function internal.get_frontend_governance_metrics() from public;
grant execute on function internal.get_frontend_governance_metrics() to authenticated;
