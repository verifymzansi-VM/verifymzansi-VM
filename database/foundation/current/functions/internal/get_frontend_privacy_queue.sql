-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_privacy_queue(p_view text DEFAULT 'open'::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');now_at timestamptz:=clock_timestamp();result jsonb;
begin
  if p_view is null or p_view not in('open','due_soon','overdue','mine','closed') or p_page is null or p_page not between 1 and 100000
    then raise exception 'valid privacy queue filters required' using errcode='22023';end if;
  with filtered as (
    select x.*,case when p_view='closed' then -extract(epoch from x.created_at) else extract(epoch from x.effective_due_at) end sort_key
      from private.privacy_requests x
      where case when p_view='closed' then x.status in('completed','rejected') else x.status in('submitted','identity_pending','in_progress') end
        and (p_view<>'mine' or x.assigned_to=actor)
        and (p_view<>'overdue' or x.effective_due_at<now_at)
        and (p_view<>'due_soon' or x.effective_due_at>=now_at and x.effective_due_at<now_at+interval '7 days')
  ), visible as (
    select x.* from filtered x order by sort_key,id limit 25 offset (p_page-1)*25
  )
  select jsonb_build_object('actor_id',actor,'total',(select count(*) from filtered),
    'overdue',(select count(*) from private.privacy_requests where status in('submitted','identity_pending','in_progress') and effective_due_at<now_at),
    'due_soon',(select count(*) from private.privacy_requests where status in('submitted','identity_pending','in_progress') and effective_due_at>=now_at and effective_due_at<now_at+interval '7 days'),
    'rules',(select jsonb_agg(jsonb_build_object('request_type',r.request_type,'extension_days',r.extension_days,'statutory',r.statutory) order by r.request_type) from private.privacy_request_rules r),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'type',v.type,'description',v.description,'status',v.status,
      'requester_email',v.requester_email,'identity_check',v.identity_check,'identity_verified',v.identity_verified,'revision',v.revision,
      'created_at',v.created_at,'received_at',v.received_at,'due_by',v.due_by,'extended_due_at',v.extended_due_at,'effective_due_at',v.effective_due_at,
      'legal_basis',v.legal_basis,'extension_reason',v.extension_reason,'extension_notified_at',v.extension_notified_at,'assigned_to',v.assigned_to,'assignee_name',p.display_name,
      'response_summary',v.response_summary,'completed_at',v.completed_at,
      'may_process',coalesce(v.subject_user_id<>actor,true) and not exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(v.requester_email)))
      order by v.sort_key,v.id) from visible v left join private.profiles p on p.account_id=v.assigned_to),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('dsar:manage');return result;
end$function$;
alter function internal.get_frontend_privacy_queue(text,integer) owner to postgres;
revoke all on function internal.get_frontend_privacy_queue(text,integer) from public;
grant execute on function internal.get_frontend_privacy_queue(text,integer) to authenticated;
