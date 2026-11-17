-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_audit_page(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid:=internal.staff_actor('audit:view');
  amount integer:=25; before_at timestamptz; before_id text;
  action_filter text; actor_filter uuid; target_filter uuid;
  from_at timestamptz; to_at timestamptz; query_text text; output jsonb; input_key text;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>4096
    or exists(select 1 from jsonb_object_keys(p_request) k where k not in
      ('limit','before_at','before_id','action','actor','target','from','to','q')) then
    raise exception 'invalid staff audit request' using errcode='22023';
  end if;
  for input_key in select jsonb_object_keys(p_request) loop
    if input_key<>'limit' and jsonb_typeof(p_request->input_key)<>'string' then
      raise exception 'invalid staff audit field type' using errcode='22023';
    end if;
  end loop;
  if p_request ? 'limit' then
    if jsonb_typeof(p_request->'limit')<>'number' or p_request->>'limit' !~ '^[0-9]{1,3}$' then
      raise exception 'invalid audit limit' using errcode='22023';
    end if;
    amount:=(p_request->>'limit')::integer;
    if amount not between 1 and 100 then raise exception 'invalid audit limit' using errcode='22023'; end if;
  end if;
  if (p_request ? 'before_at')<>(p_request ? 'before_id') then
    raise exception 'complete audit cursor required' using errcode='22023';
  end if;
  if p_request ? 'before_at' then
    if jsonb_typeof(p_request->'before_at')<>'string' or jsonb_typeof(p_request->'before_id')<>'string'
      or p_request->>'before_id' !~ '^[a-z_]+:[a-zA-Z0-9-]{1,40}$' then
      raise exception 'invalid audit cursor' using errcode='22023';
    end if;
    before_at:=(p_request->>'before_at')::timestamptz; before_id:=p_request->>'before_id';
  end if;
  if p_request ? 'action' then
    if jsonb_typeof(p_request->'action')<>'string' or p_request->>'action' !~ '^[a-z_]+(:[a-z_]+)?$'
      or length(p_request->>'action')>100 then raise exception 'invalid audit action' using errcode='22023'; end if;
    action_filter:=p_request->>'action';
  end if;
  if p_request ? 'actor' then actor_filter:=(p_request->>'actor')::uuid; end if;
  if p_request ? 'target' then target_filter:=(p_request->>'target')::uuid; end if;
  if p_request ? 'from' then
    if p_request->>'from' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid audit date' using errcode='22023'; end if;
    from_at:=(p_request->>'from')::date::timestamp at time zone 'Africa/Johannesburg';
  end if;
  if p_request ? 'to' then
    if p_request->>'to' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid audit date' using errcode='22023'; end if;
    to_at:=((p_request->>'to')::date+1)::timestamp at time zone 'Africa/Johannesburg';
  end if;
  if from_at is not null and to_at is not null and from_at>=to_at then
    raise exception 'invalid audit date range' using errcode='22023';
  end if;
  if p_request ? 'q' then
    if jsonb_typeof(p_request->'q')<>'string' or length(p_request->>'q') not between 1 and 100 then
      raise exception 'invalid audit search' using errcode='22023';
    end if;
    query_text:=lower(p_request->>'q');
  end if;
  with events as (
    select 'moderation:'||m.id::text id,m.decided_at occurred_at,m.staff_id actor_id,
      m.post_id target_id,'post'::text target_type,'post:'||m.decision action,m.reason
      from private.moderation_log m
    union all select 'evidence_access:'||e.id::text,e.accessed_at,e.staff_id,e.case_id,'case','evidence:read',e.purpose
      from private.evidence_access_log e
    union all select 'decision_proposed:'||d.id::text,d.proposed_at,d.proposed_by,d.case_id,'case','decision:proposed',null::text
      from private.decisions d
    union all select 'decision_approved:'||d.id::text,d.approved_at,d.approved_by,d.case_id,'case','decision:approved',null::text
      from private.decisions d where d.approved_at is not null
    union all select 'decision_withdrawn:'||d.id::text,d.withdrawn_at,d.withdrawn_by,d.case_id,'case','decision:withdrawn',d.withdrawal_reason
      from private.decisions d where d.withdrawn_at is not null
    union all select 'organisation:'||o.id::text,o.created_at,o.actor_id,o.organisation_id,'organisation','organisation:'||o.action,o.reason
      from private.organisation_events o
    union all select 'partner:'||p.id::text,p.created_at,p.actor_id,p.partner_id,'partner','partner:'||p.action,p.reason
      from private.partner_events p
    union all select 'queue:'||q.id::text,q.created_at,q.actor_id,coalesce(q.post_id,q.report_id),
      case when q.post_id is null then 'report' else 'post' end,'queue:'||q.event,q.reason
      from private.queue_claim_events q
    union all select 'staff_granted:'||r.id::text,r.granted_at,r.granted_by,r.user_id,'account','staff:granted',null::text
      from private.staff_roles r
    union all select 'staff_revoked:'||r.id::text,r.revoked_at,r.revoked_by,r.user_id,'account','staff:revoked',null::text
      from private.staff_roles r where r.revoked_at is not null
  ), page as (
    select e.* from events e
    where (before_at is null or (e.occurred_at,e.id)<(before_at,before_id))
      and (action_filter is null or starts_with(e.action,action_filter))
      and (actor_filter is null or e.actor_id=actor_filter)
      and (target_filter is null or e.target_id=target_filter)
      and (from_at is null or e.occurred_at>=from_at) and (to_at is null or e.occurred_at<to_at)
      and (query_text is null or position(query_text in lower(coalesce(e.reason,'')))>0)
    order by e.occurred_at desc,e.id desc limit amount+1
  ), visible as (select * from page order by occurred_at desc,id desc limit amount)
  select jsonb_build_object('version',1,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'occurred_at',e.occurred_at,'actor_id',e.actor_id,'actor_name',internal.profile_public_name(p.display_name),
      'target_id',e.target_id,'target_type',e.target_type,'action',e.action,'reason',e.reason)
      order by e.occurred_at desc,e.id desc)
      from visible e left join private.profiles p on p.account_id=e.actor_id),'[]'::jsonb),
    'next_cursor',case when (select count(*) from page)>amount then
      (select jsonb_build_object('before_at',occurred_at,'before_id',id)
       from visible order by occurred_at,id limit 1) else null end) into output;
  return output;
end;
$function$;
alter function internal.staff_audit_page(jsonb) owner to postgres;
revoke all on function internal.staff_audit_page(jsonb) from public;
grant execute on function internal.staff_audit_page(jsonb) to authenticated;
