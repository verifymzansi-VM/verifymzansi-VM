-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_decision_page(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid:=internal.staff_actor('decision:approve'); amount integer:=25;
  status_filter text:='proposed'; action_filter text; case_filter uuid; id_filter uuid;
  before_at timestamptz; before_id uuid; output jsonb; input_key text;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>4096
    or exists(select 1 from jsonb_object_keys(p_request) k where k not in
      ('limit','status','action','case_id','id','before_at','before_id')) then
    raise exception 'invalid staff decision request' using errcode='22023';
  end if;
  for input_key in select jsonb_object_keys(p_request) loop
    if input_key<>'limit' and jsonb_typeof(p_request->input_key)<>'string' then
      raise exception 'invalid staff decision field type' using errcode='22023';
    end if;
  end loop;
  if p_request ? 'limit' then
    if jsonb_typeof(p_request->'limit')<>'number' or p_request->>'limit' !~ '^[0-9]{1,3}$' then
      raise exception 'invalid decision limit' using errcode='22023'; end if;
    amount:=(p_request->>'limit')::integer;
    if amount not between 1 and 100 then raise exception 'invalid decision limit' using errcode='22023'; end if;
  end if;
  if p_request ? 'status' then
    status_filter:=p_request->>'status';
    if status_filter is null or status_filter not in ('proposed','approved','withdrawn','all') then
      raise exception 'invalid decision status' using errcode='22023'; end if;
  end if;
  if p_request ? 'action' then
    action_filter:=p_request->>'action';
    if action_filter is null or action_filter not in ('approve_override','reject','restrict_account') then
      raise exception 'invalid decision action' using errcode='22023'; end if;
  end if;
  if p_request ? 'case_id' then case_filter:=(p_request->>'case_id')::uuid; end if;
  if p_request ? 'id' then id_filter:=(p_request->>'id')::uuid; end if;
  if (p_request ? 'before_at')<>(p_request ? 'before_id') then
    raise exception 'complete decision cursor required' using errcode='22023'; end if;
  if p_request ? 'before_at' then
    before_at:=(p_request->>'before_at')::timestamptz; before_id:=(p_request->>'before_id')::uuid;
    if before_at is null or before_id is null then raise exception 'invalid decision cursor' using errcode='22023'; end if;
  end if;
  with page as (
    select d.*,c.kind case_kind,c.version current_case_version,c.status case_status,c.subject_id
    from private.decisions d join private.evidence_cases c on c.id=d.case_id
    where (status_filter='all' or d.status=status_filter) and not(status_filter='proposed' and d.scope_kind<>'native' and not internal.current_report_proposal(d.id))
      and (action_filter is null or d.action=action_filter)
      and (case_filter is null or d.case_id=case_filter) and (id_filter is null or d.id=id_filter)
      and (before_at is null or (d.proposed_at,d.id)<(before_at,before_id))
    order by d.proposed_at desc,d.id desc limit amount+1
  ), visible as (select * from page order by proposed_at desc,id desc limit amount)
  select jsonb_build_object('version',1,'caller_id',actor,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'case_id',d.case_id,'subject_id',d.subject_id,'case_kind',d.case_kind,'action',d.action,'status',d.status,
      'case_version',d.case_version,'current_case_version',d.current_case_version,
      'proposed_by',d.proposed_by,'proposed_at',d.proposed_at,'approved_by',d.approved_by,'approved_at',d.approved_at,
      'withdrawn_by',d.withdrawn_by,'withdrawn_at',d.withdrawn_at,'withdrawal_reason',d.withdrawal_reason,
      'can_approve',d.status='proposed' and d.proposed_by<>actor and d.subject_id<>actor and d.case_status='open' and d.case_version=d.current_case_version,
      'can_withdraw',d.status='proposed' and (d.proposed_by=actor or d.case_version<>d.current_case_version))
      order by d.proposed_at desc,d.id desc) from visible d),'[]'::jsonb),
    'next_cursor',case when (select count(*) from page)>amount then
      (select jsonb_build_object('before_at',proposed_at,'before_id',id)
       from visible order by proposed_at,id limit 1) else null end) into output;
  return output;
end;
$function$;
alter function internal.staff_decision_page(jsonb) owner to postgres;
revoke all on function internal.staff_decision_page(jsonb) from public;
grant execute on function internal.staff_decision_page(jsonb) to authenticated;
