-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_governance_page(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('decision:approve'); page jsonb;notes jsonb;
begin
  page:=internal.staff_decision_page(p_request);
  select coalesce(jsonb_agg(jsonb_build_object('decision_id',d.id,
    'report_id',r.id,'display_category',case when a.action='ban' then 'account_ban' when a.action='suspend' then 'account_suspend' end,
    'proposal_expired',coalesce(rp.expires_at<=clock_timestamp(),false),'reporter_conflict',coalesce(r.reporter_id=actor,false),
    'recommendation',case when rp.decision_id is not null then (case a.action when 'ban' then 'Ban this account.' else 'Suspend this account for '||a.duration_days||' days.' end)||' Report: '||r.id||'. Reason: '||a.reason
    when d.action='approve_override' and d.payload ? 'identity_submission_id'
      then 'Independent identity review requested. Claim the verification case and inspect both current documents before approving.'
      when d.action='restrict_account' then 'Independent review of a proposed account restriction.'
      else 'Independent review of the proposed '||replace(d.action,'_',' ')||' decision.' end,
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'actor_id',e.actor_id,'action',e.action,'reason',e.reason,'created_at',e.created_at) order by e.created_at,e.id)
      from private.frontend_governance_events e where e.decision_id=d.id),'[]'::jsonb)) order by d.proposed_at desc,d.id desc),'[]'::jsonb)
    into notes from private.decisions d left join private.frontend_report_proposals rp on rp.decision_id=d.id left join private.frontend_report_action_receipts a on a.id=rp.receipt_id left join private.reports r on r.id=a.report_id where d.id in(select (v.value->>'id')::uuid from jsonb_array_elements(page->'items') v(value));
  perform internal.staff_actor('decision:approve');
  return jsonb_build_object('native',page,'presentation',notes);
end$function$;
alter function internal.get_frontend_governance_page(jsonb) owner to postgres;
revoke all on function internal.get_frontend_governance_page(jsonb) from public;
grant execute on function internal.get_frontend_governance_page(jsonb) to authenticated;
