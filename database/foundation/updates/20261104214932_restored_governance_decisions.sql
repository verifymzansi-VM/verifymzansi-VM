-- Preserve governance queue/detail/actions without restoring the old ledger.
-- Native decisions keep their immutable proposal and native transactional effects.
begin;
create table private.frontend_governance_events(
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references private.decisions(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in('approve','reject','withdraw','escalate')),
  reason text not null check(length(reason) between 1 and 2000),
  case_version integer not null check(case_version>0),
  created_at timestamptz not null default clock_timestamp(),
  unique(decision_id,action)
);
create index frontend_governance_actor_idx on private.frontend_governance_events(actor_id);
alter table private.frontend_governance_events enable row level security;
revoke all on private.frontend_governance_events from public,anon,authenticated,service_role;
-- Parent decisions are retained. Event writes happen only within the command;
-- actor anonymisation on account deletion follows the parent audit convention.

create function internal.get_frontend_governance_page(p_request jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:approve'); page jsonb;notes jsonb;
begin
  page:=internal.staff_decision_page(p_request);
  select coalesce(jsonb_agg(jsonb_build_object('decision_id',d.id,
    'recommendation',case when d.action='approve_override' and d.payload ? 'identity_submission_id'
      then 'Independent identity review requested. Claim the verification case and inspect both current documents before approving.'
      when d.action='restrict_account' then 'Independent review of a proposed account restriction.'
      else 'Independent review of the proposed '||replace(d.action,'_',' ')||' decision.' end,
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'actor_id',e.actor_id,'action',e.action,'reason',e.reason,'created_at',e.created_at) order by e.created_at,e.id)
      from private.frontend_governance_events e where e.decision_id=d.id),'[]'::jsonb)) order by d.proposed_at desc,d.id desc),'[]'::jsonb)
    into notes from private.decisions d where d.id in(select (v.value->>'id')::uuid from jsonb_array_elements(page->'items') v(value));
  perform internal.staff_actor('decision:approve');
  return jsonb_build_object('native',page,'presentation',notes);
end$$;
revoke all on function internal.get_frontend_governance_page(jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_governance_page(jsonb) to authenticated;
create function api.get_frontend_governance_page(p_request jsonb default '{}')
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_governance_page(p_request)$$;
revoke all on function api.get_frontend_governance_page(jsonb) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_governance_page(jsonb) to authenticated;

create function internal.decide_frontend_governance(p_decision uuid,p_case uuid,p_expected_version integer,p_proposal_version integer,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:approve'); subject uuid;actual_case uuid;
  c private.evidence_cases;d private.decisions;prior private.frontend_governance_events;
  reason text;operation text;answer jsonb;s private.verification_identity_submissions;
begin
  if p_action is null or p_action not in('approve','reject','escalate') or p_expected_version is null or p_proposal_version is null then
    raise exception 'represented governance action required' using errcode='22023';end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":1,"maxLength":2000}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid rationale required' using errcode='22023';end if;
  select x.case_id,e.subject_id into actual_case,subject from private.decisions x join private.evidence_cases e on e.id=x.case_id where x.id=p_decision;
  if not found or p_case is distinct from actual_case then raise exception 'represented proposal unavailable' using errcode='PT409';end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases where id=actual_case for update;
  select * into d from private.decisions where id=p_decision for update;
  actor:=internal.staff_actor('decision:approve');
  if actor=c.subject_id then raise exception 'self-review is not allowed' using errcode='42501';end if;
  if d.case_version is distinct from p_proposal_version then raise exception 'represented proposal changed' using errcode='PT409';end if;
  operation:=case when p_action='reject' and d.proposed_by=actor then 'withdraw' else p_action end;
  select * into prior from private.frontend_governance_events e where e.decision_id=d.id and e.action=operation;
  if found then
    if prior.actor_id=actor and prior.reason=reason and prior.case_version=p_expected_version
      and (operation='approve' and d.status='approved' and d.approved_by=actor
        or operation in('withdraw','reject') and d.status='withdrawn' and d.withdrawn_by=actor
        or operation='escalate' and d.status='proposed' and c.version=p_expected_version) then
      return jsonb_build_object('decision_id',d.id,'status',case operation when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' else 'escalated' end,'reused',true);
    end if;
    raise exception 'governance request already recorded differently' using errcode='PT409';
  end if;
  if d.status<>'proposed' or c.version is distinct from p_expected_version then raise exception 'proposal already decided or case changed' using errcode='PT409';end if;
  if operation='withdraw' then
    -- The authored withdrawal command retains its own current capability and
    -- reason checks. It is never an approval or an identity grant.
    answer:=internal.withdraw_decision(d.id,p_expected_version,reason);
  else
    if c.status<>'open' or c.version<>d.case_version or internal.evidence_case_snapshot(c.id) is distinct from d.reviewed_snapshot then
      raise exception 'case changed after proposal' using errcode='PT409';end if;
    if operation in('approve','reject') and actor=d.proposed_by then raise exception 'independent reviewer required' using errcode='42501';end if;
    if operation='approve' then
      if d.action='approve_override' and d.payload ? 'identity_submission_id' then
        select * into s from private.verification_identity_submissions where id::text=d.payload->>'identity_submission_id' and case_id=c.id;
        perform internal.assert_evidence_claim(c,actor,c.claim_generation::text,c.claim_nonce);
        if s.id is null or not exists(select 1 from private.evidence_access_log l where l.staff_id=actor and l.case_id=c.id
          and l.case_version=c.version and l.claim_generation=c.claim_generation and l.purpose='routine_review'
          and l.artifact_ids @> array[s.id_artifact_id,s.selfie_artifact_id]
          and l.accessed_at>clock_timestamp()-interval '15 minutes') then
          raise exception 'inspect current identity evidence before independent approval' using errcode='PT409';end if;
      end if;
      answer:=internal.approve_decision(d.id);
    elsif operation='reject' then
      -- Rejecting a proposal has no effect on the subject's identity or access.
      -- Close the proposal using the retained native withdrawal audit fields.
      update private.decisions set status='withdrawn',withdrawn_by=actor,withdrawn_at=clock_timestamp(),
        withdrawn_case_version=c.version,withdrawal_reason=reason where id=d.id;
    end if;
  end if;
  insert into private.frontend_governance_events(decision_id,actor_id,action,reason,case_version)
    values(d.id,actor,operation,reason,p_expected_version);
  perform internal.staff_actor('decision:approve');
  return jsonb_build_object('decision_id',d.id,'status',case operation when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' else 'escalated' end);
end$$;
revoke all on function internal.decide_frontend_governance(uuid,uuid,integer,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.decide_frontend_governance(uuid,uuid,integer,integer,text,text) to authenticated;
create function api.decide_frontend_governance(p_decision uuid,p_case uuid,p_expected_version integer,p_proposal_version integer,p_action text,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.decide_frontend_governance(p_decision,p_case,p_expected_version,p_proposal_version,p_action,p_reason)$$;
revoke all on function api.decide_frontend_governance(uuid,uuid,integer,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function api.decide_frontend_governance(uuid,uuid,integer,integer,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
