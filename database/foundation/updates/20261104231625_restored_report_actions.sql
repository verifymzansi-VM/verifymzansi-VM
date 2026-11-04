-- A represented report command and exact retry receipt. The existing native
-- dismissal remains the authority for conflict, claim and resolution checks.
begin;
create table private.frontend_report_action_receipts(
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references private.reports(id) on delete cascade,
  expected_revision integer not null check(expected_revision>0),
  claim_generation bigint not null check(claim_generation>0),
  claim_nonce_digest text not null check(claim_nonce_digest ~ '^[a-f0-9]{64}$'),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in('dismiss','warn','hide','suspend','ban')),
  reason text not null check(length(reason) between 5 and 500),
  duration_days integer check(duration_days between 1 and 30),
  emergency boolean not null,
  status text not null check(status in('dismissed','applied','proposed','emergency_applied')),
  acknowledged_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(report_id,expected_revision),unique(report_id,claim_generation)
);
create index frontend_report_receipt_actor_idx on private.frontend_report_action_receipts(actor_id);
alter table private.frontend_report_action_receipts enable row level security;
revoke all on private.frontend_report_action_receipts from public,anon,authenticated,service_role;
create function internal.execute_frontend_report_action(p_report uuid,p_expected_revision integer,p_claim_generation text,p_claim_nonce uuid,p_action text,p_reason text,p_duration_days integer default null,p_emergency boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('report:resolve');r private.reports;q private.queue_claims;prior private.frontend_report_action_receipts;reason text;answer jsonb;
begin
  if p_action is null or p_action not in('dismiss','warn','hide','suspend','ban') or p_expected_revision is null or p_expected_revision<1 or p_emergency is null then raise exception 'represented report action required' using errcode='22023';end if;
  -- Additional enforcement effects are integrated separately; an unimplemented
  -- action must never receive a successful native acknowledgement.
  if p_action<>'dismiss' then raise exception 'native report enforcement integration is pending' using errcode='0A000';end if;
  if p_duration_days is not null or p_emergency then raise exception 'dismissal has no suspension parameters' using errcode='22023';end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid review reason required' using errcode='22023';end if;
  select * into r from private.reports where id=p_report for update;
  if not found then raise exception 'report unavailable' using errcode='PT409';end if;
  actor:=internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor,null,p_report) then raise exception 'self-review is not allowed' using errcode='42501';end if;
  select * into prior from private.frontend_report_action_receipts x where x.report_id=p_report and x.expected_revision=p_expected_revision;
  if found then
    if prior.actor_id=actor and prior.action=p_action and prior.reason=reason and prior.claim_generation::text=p_claim_generation
      and prior.claim_nonce_digest=encode(sha256(convert_to(p_claim_nonce::text,'UTF8')),'hex') and prior.acknowledged_until>clock_timestamp()
      and r.status='dismissed' and r.resolved_by=actor and r.resolution_note=reason then
      return jsonb_build_object('report_id',r.id,'action',p_action,'status',prior.status,'reused',true);
    end if;
    raise exception 'report action receipt changed' using errcode='PT409';
  end if;
  if r.revision<>p_expected_revision or r.status<>'open' then raise exception 'report changed since review' using errcode='PT409';end if;
  select * into q from private.queue_claims where report_id=r.id for update;
  perform internal.assert_queue_claim(q,actor,p_claim_generation,p_claim_nonce);
  answer:=internal.resolve_report(r.id,p_claim_generation,p_claim_nonce,'dismissed',reason);
  if answer->>'id' is distinct from r.id::text or answer->>'status' is distinct from 'dismissed' then raise exception 'native report outcome could not be confirmed' using errcode='PT409';end if;
  insert into private.frontend_report_action_receipts(report_id,expected_revision,claim_generation,claim_nonce_digest,actor_id,action,reason,duration_days,emergency,status,acknowledged_until)
    values(r.id,p_expected_revision,q.claim_generation,encode(sha256(convert_to(q.claim_nonce::text,'UTF8')),'hex'),actor,p_action,reason,null,false,'dismissed',q.claim_expires_at);
  perform internal.staff_actor('report:resolve');
  return jsonb_build_object('report_id',r.id,'action',p_action,'status','dismissed');
end$$;
revoke all on function internal.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) to authenticated;
create function api.execute_frontend_report_action(p_report uuid,p_expected_revision integer,p_claim_generation text,p_claim_nonce uuid,p_action text,p_reason text,p_duration_days integer default null,p_emergency boolean default false)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.execute_frontend_report_action(p_report,p_expected_revision,p_claim_generation,p_claim_nonce,p_action,p_reason,p_duration_days,p_emergency)$$;
revoke all on function api.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function api.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
