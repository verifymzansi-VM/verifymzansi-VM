-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_report_review_queue(p_area text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');result jsonb;items jsonb;
begin
  result:=internal.get_frontend_report_queue(p_area);
  select coalesce(jsonb_agg(case when internal.current_report_proposal(r.active_proposal_id) then jsonb_set(x.value,'{status}','"in_progress"'::jsonb)||jsonb_build_object('awaiting_decision',true) when x.value->'foundation'<>'null'::jsonb then
    jsonb_set(x.value,'{foundation}',x.value->'foundation'||jsonb_build_object('expectedPostRevision',p.revision)) else x.value end order by x.n),'[]'::jsonb)
    into items from jsonb_array_elements(result->'items') with ordinality x(value,n)
    left join private.reports r on r.id::text=x.value->>'id' left join private.posts p on p.id=r.post_id;
  perform internal.staff_actor('queue:view');return jsonb_set(result,'{items}',items);
end$function$;
alter function internal.get_frontend_report_review_queue(text) owner to postgres;
revoke all on function internal.get_frontend_report_review_queue(text) from public;
grant execute on function internal.get_frontend_report_review_queue(text) to authenticated;
