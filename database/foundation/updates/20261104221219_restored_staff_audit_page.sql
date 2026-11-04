-- Numbered pages and filters for the preserved audit screen, using a closed
-- native event projection. No evidence keys or proposal payloads are included.
begin;
create index frontend_identity_step_artifact_idx on private.frontend_identity_step_approvals(artifact_id);
create index frontend_identity_step_reviewer_idx on private.frontend_identity_step_approvals(reviewer_id);
do $$declare body text;start_at integer;end_at integer;events text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.staff_audit_page(jsonb)'::regprocedure;
  if md5(body)<>'444e420d9958b85e01271da2e31be420' then raise exception 'native audit projection drift';end if;
  start_at:=position('  with events as (' in body)+length('  with events as (');
  end_at:=position('  ), page as (' in body);
  if start_at<=length('  with events as (') or end_at<=start_at then raise exception 'native audit projection anchors missing';end if;
  events:=substring(body from start_at for end_at-start_at);
  execute 'create view private.frontend_staff_audit_events with (security_invoker=true) as '||events||$extra$
    union all select 'governance_note:'||g.id::text,g.created_at,g.actor_id,d.case_id,'case','governance:'||g.action,g.reason
      from private.frontend_governance_events g join private.decisions d on d.id=g.decision_id
    union all select 'feature_flag:'||f.id::text,f.created_at,f.actor_id,f.flag_id,'feature_flag','feature_flag:updated',f.reason
      from private.frontend_feature_flag_events f
    union all select 'evidence_claim:'||h.id::text,h.created_at,h.actor_id,h.case_id,'case','queue:'||h.event,h.reason
      from private.frontend_evidence_claim_events h
  $extra$;
end$$;
revoke all on private.frontend_staff_audit_events from public,anon,authenticated,service_role;

create function internal.get_frontend_staff_audit_page(p_request jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('audit:view');page_number integer:=1;amount integer:=50;
  prefix text;kind text;by_actor uuid;target uuid;from_at timestamptz;to_at timestamptz;query_text text;rows jsonb;total bigint;k text;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>4096
    or exists(select 1 from jsonb_object_keys(p_request) x where x not in('page','action','type','actor','target','from','to','q')) then
    raise exception 'valid audit filters required' using errcode='22023';end if;
  for k in select jsonb_object_keys(p_request) loop
    if k<>'page' and jsonb_typeof(p_request->k)<>'string' then raise exception 'invalid audit filter type' using errcode='22023';end if;
  end loop;
  if p_request ? 'page' then
    if jsonb_typeof(p_request->'page')<>'number' or p_request->>'page' !~ '^[1-9][0-9]{0,5}$' then raise exception 'valid audit page required' using errcode='22023';end if;
    page_number:=(p_request->>'page')::integer;
    if page_number>100000 then raise exception 'audit page limit exceeded' using errcode='22023';end if;
  end if;
  if p_request ? 'action' then
    prefix:=lower(p_request->>'action');
    if prefix !~ '^[a-z0-9_:]{1,80}$' then raise exception 'valid action prefix required' using errcode='22023';end if;
  end if;
  if p_request ? 'type' then
    kind:=lower(p_request->>'type');
    if kind !~ '^[a-z0-9_]{1,80}$' then raise exception 'valid target type required' using errcode='22023';end if;
  end if;
  if p_request ? 'actor' then by_actor:=(p_request->>'actor')::uuid;end if;
  if p_request ? 'target' then target:=(p_request->>'target')::uuid;end if;
  if p_request ? 'from' then
    if p_request->>'from' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'valid audit date required' using errcode='22023';end if;
    from_at:=(p_request->>'from')::date::timestamp at time zone 'Africa/Johannesburg';
  end if;
  if p_request ? 'to' then
    if p_request->>'to' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'valid audit date required' using errcode='22023';end if;
    to_at:=((p_request->>'to')::date+1)::timestamp at time zone 'Africa/Johannesburg';
  end if;
  if from_at is not null and to_at is not null and from_at>=to_at then raise exception 'ordered audit dates required' using errcode='22023';end if;
  if p_request ? 'q' then
    query_text:=lower(btrim(p_request->>'q'));
    if length(query_text) not between 1 and 100 then raise exception 'bounded audit search required' using errcode='22023';end if;
  end if;
  with filtered as materialized(
    select e.* from private.frontend_staff_audit_events e
    where (prefix is null or starts_with(replace(e.action,':','_'),replace(prefix,':','_'))) and (kind is null or e.target_type=kind)
      and (by_actor is null or e.actor_id=by_actor) and (target is null or e.target_id=target)
      and (from_at is null or e.occurred_at>=from_at) and (to_at is null or e.occurred_at<to_at)
      and (query_text is null or position(query_text in lower(coalesce(e.reason,'')))>0)
  ), visible as(select * from filtered order by occurred_at desc,id desc limit amount offset (page_number-1)*amount)
  select (select count(*) from filtered),coalesce((select jsonb_agg(jsonb_build_object(
    'id',e.id,'occurred_at',e.occurred_at,'actor_id',e.actor_id,'actor_name',internal.profile_public_name(p.display_name),
    'target_id',e.target_id,'target_type',e.target_type,'action',replace(e.action,':','_'),'reason',e.reason) order by e.occurred_at desc,e.id desc)
    from visible e left join private.profiles p on p.account_id=e.actor_id),'[]'::jsonb) into total,rows;
  perform internal.staff_actor('audit:view');
  return jsonb_build_object('account_id',actor,'page',page_number,'limit',amount,'total',total,'items',rows);
end$$;
revoke all on function internal.get_frontend_staff_audit_page(jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_staff_audit_page(jsonb) to authenticated;
create function api.get_frontend_staff_audit_page(p_request jsonb default '{}') returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_staff_audit_page(p_request)$$;
revoke all on function api.get_frontend_staff_audit_page(jsonb) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_staff_audit_page(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
