-- No account restriction for an active admin (launch checklist item 20, part
-- 3). Until now two governors could ban an admin (identity ban, or a report
-- ban a moderator proposed and a governor approved), and one governor alone
-- could put an admin under 72-hour emergency containment, again and again. A
-- restriction removes account access, so internal.staff_actor then refused the
-- admin, even the last one: the last-admin guard watches only staff roles.
--
-- From this update an account restriction (ban, suspension or emergency
-- containment) is refused with PT409 "End this person's admin role first"
-- (detail subject_is_admin) while the person holds an active admin role
-- (private.staff_roles role 'admin', revoked_at null). Removing an admin goes
-- through the existing role change, approved by a different admin. Erasure
-- already refuses staff accounts (internal.order_account_erasure).
--
-- Every path that restricts an account goes through one of these three
-- functions (full bodies; api wrappers, arguments, results and grants are
-- unchanged):
-- * internal.propose_decision: api.propose_decision with restrict_account, and
--   internal.propose_verified_identity_ban, which calls it;
-- * internal.propose_frontend_report_restriction: report suspensions and bans
--   (api.execute_frontend_report_action_v2 'suspend'/'ban'), including the
--   emergency containment it applies at once;
-- * internal.approve_decision: every approval (api.approve_decision and
--   api.decide_frontend_governance), checked again in case the person became
--   an admin after the proposal. Approval is the only way a proposal takes
--   effect (internal.frontend_report_restriction_effect,
--   internal.bind_native_restriction_for_review and
--   internal.verification_decision_effect run on it).
-- Each check runs after the subject's lock, which role changes also take.
--
-- Expand only: three replaced bodies; no command, argument or grant changes.
-- ORDER: website-first (merge and deploy, then apply straight after): the
-- website words the new refusal; either order is safe.
-- It refuses with 55000 unless each function has its reviewed body (or this
-- update's).
-- Read-only preflight: ../preflight/20261125174942_end_admin_role_before_restriction.check.sql.
-- Rollback: ../rollback/20261125174942_end_admin_role_before_restriction.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.propose_decision(uuid,integer,text,jsonb)');
  if body is null or body not in('03ca62789e3072be4ad9f2674f623585','14c5db672f2151a86ad769d3629df3ce') then
    raise exception 'end admin role before restriction precondition: internal.propose_decision(uuid,integer,text,jsonb) is not a reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.propose_frontend_report_restriction(uuid,integer,text,uuid,text,text,integer,boolean)');
  if body is null or body not in('99896a347df072ba0d1aca2c86839e7b','93ce413d7760cf1e4a4da586cf180e47') then
    raise exception 'end admin role before restriction precondition: internal.propose_frontend_report_restriction(uuid,integer,text,uuid,text,text,integer,boolean) is not a reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.approve_decision(uuid)');
  if body is null or body not in('baf094a3e7e2985bf0962c1a8922c7cb','46ede56eac0b30fae87597fa886ef604') then
    raise exception 'end admin role before restriction precondition: internal.approve_decision(uuid) is not a reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

create or replace function internal.propose_decision(p_case_id uuid,p_expected_version integer,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := internal.staff_actor('decision:propose'); c private.evidence_cases; d private.decisions; subject uuid;
begin
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 then
    raise exception 'positive expected case version required' using errcode='22023';
  end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id for update;
  if not found or c.status <> 'open' then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('decision:propose');
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  if c.version <> p_expected_version then raise exception 'case changed since review' using errcode = 'PT409'; end if;
  -- 20261125174942: an account is never restricted while it holds an active
  -- admin role; that role ends first, with another admin's approval.
  if p_action = 'restrict_account' and exists(select 1 from private.staff_roles s
      where s.user_id = c.subject_id and s.role = 'admin' and s.revoked_at is null) then
    raise exception 'End this person''s admin role first' using errcode = 'PT409', detail = 'subject_is_admin';
  end if;
  insert into private.decisions (case_id, action, payload, case_version, reviewed_snapshot, proposed_by)
  values (c.id, p_action, coalesce(p_payload, '{}'), c.version, internal.evidence_case_snapshot(c.id), actor) returning * into d;
  return jsonb_build_object('decision_id', d.id, 'case_version', d.case_version);
end;
$$;
revoke all on function internal.propose_decision(uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.propose_decision(uuid,integer,text,jsonb) to authenticated;

create or replace function internal.propose_frontend_report_restriction(p_report uuid,p_expected_revision integer,p_generation text,p_nonce uuid,p_action text,p_reason text,p_days integer,p_emergency boolean)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('report:resolve');subject uuid;reason text;r private.reports;q private.queue_claims;
  prior private.frontend_report_action_receipts;proposal private.frontend_report_proposals;case_row private.evidence_cases;
  fact uuid;payload jsonb:='{}';decision uuid;receipt uuid:=gen_random_uuid();started timestamptz;deadline timestamptz;result_status text;
begin
  if p_action is null or p_action not in('suspend','ban') or p_emergency is null or p_expected_revision is null or p_expected_revision<1
    or p_action='suspend' and (p_days is null or p_days not between 1 and 30) or p_action='ban' and p_days is not null then raise exception 'valid represented restriction required' using errcode='22023';end if;
  if p_emergency then perform internal.staff_actor('account:contain');end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid restriction rationale required' using errcode='22023';end if;
  select subject_account_id into subject from private.reports where id=p_report;
  if not found then raise exception 'report unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into r from private.reports where id=p_report for update;
  actor:=internal.staff_actor('report:resolve');if p_emergency then perform internal.staff_actor('account:contain');end if;
  if r.subject_account_id is distinct from subject or internal.queue_conflict(actor,null,p_report) then raise exception 'independent report review required' using errcode='42501';end if;
  select * into prior from private.frontend_report_action_receipts x where x.report_id=p_report and x.expected_revision=p_expected_revision;
  if found then
    select * into proposal from private.frontend_report_proposals p where p.receipt_id=prior.id;
    if prior.actor_id=actor and prior.action=p_action and prior.reason=reason and prior.duration_days is not distinct from p_days and prior.emergency=p_emergency
      and prior.claim_generation::text=p_generation and prior.claim_nonce_digest=encode(sha256(convert_to(p_nonce::text,'UTF8')),'hex')
      and prior.acknowledged_until>clock_timestamp() and r.active_proposal_id=proposal.decision_id and internal.current_report_proposal(proposal.decision_id) then
      return jsonb_build_object('report_id',r.id,'action',p_action,'status',prior.status,'decision_id',proposal.decision_id,'reused',true);
    end if;
    raise exception 'restriction proposal changed' using errcode='PT409';
  end if;
  if r.status<>'open' or r.revision<>p_expected_revision or internal.current_report_proposal(r.active_proposal_id)
    or exists(select 1 from private.account_closures c where c.user_id=subject) or not exists(select 1 from auth.users u where u.id=subject and u.deleted_at is null) then raise exception 'report or subject changed' using errcode='PT409';end if;
  -- 20261125174942: no suspension, ban or emergency containment of an active
  -- admin; their admin role ends first, with another admin's approval.
  if exists(select 1 from private.staff_roles s where s.user_id=subject and s.role='admin' and s.revoked_at is null)
    then raise exception 'End this person''s admin role first' using errcode='PT409',detail='subject_is_admin';end if;
  select * into q from private.queue_claims where report_id=r.id for update;
  perform internal.assert_queue_claim(q,actor,p_generation,p_nonce);
  if p_action='ban' then
    select f.id into fact from private.accepted_identity_facts f where f.owner_id=subject and f.revoked_at is null order by f.reviewed_at desc,f.id limit 1;
    if fact is not null then payload:=jsonb_build_object('identity_fact_id',fact,'identity_ban_category',case r.category when 'scam' then 'fraud' when 'impersonation' then 'impersonation' when 'harassment' then 'harassment' when 'misleading_info' then 'fake_listings' else 'other' end);end if;
  end if;
  started:=clock_timestamp();deadline:=started+case when p_emergency then interval '72 hours' else interval '7 days' end;
  insert into private.evidence_cases(subject_id,kind) values(subject,'restriction') returning * into case_row;
  insert into private.decisions(case_id,action,payload,case_version,reviewed_snapshot,proposed_by,proposed_at,scope_kind,suspension_days)
    values(case_row.id,'restrict_account',payload,case_row.version,internal.evidence_case_snapshot(case_row.id),actor,started,case p_action when 'ban' then 'report_ban' else 'report_suspension' end,p_days) returning id into decision;
  perform internal.consume_queue_claim('report',r.id,actor,p_generation,p_nonce);
  update private.reports set active_proposal_id=decision where id=r.id returning * into r;
  result_status:=case when p_emergency then 'emergency_applied' else 'proposed' end;
  insert into private.frontend_report_action_receipts(id,report_id,expected_revision,claim_generation,claim_nonce_digest,actor_id,action,reason,duration_days,emergency,status,acknowledged_until)
    values(receipt,r.id,p_expected_revision,q.claim_generation,encode(sha256(convert_to(q.claim_nonce::text,'UTF8')),'hex'),actor,p_action,reason,p_days,p_emergency,result_status,q.claim_expires_at);
  insert into private.frontend_report_proposals(decision_id,receipt_id,report_revision,expires_at) values(decision,receipt,r.revision,deadline);
  if p_emergency then insert into private.frontend_account_restrictions(decision_id,account_id,reporter_id,kind,reason,emergency,starts_at,ends_at)
    values(decision,subject,r.reporter_id,'suspension',reason,true,started,deadline);end if;
  perform internal.staff_actor('report:resolve');if p_emergency then perform internal.staff_actor('account:contain');end if;
  return jsonb_build_object('report_id',r.id,'action',p_action,'status',result_status,'decision_id',decision);
end$$;
revoke all on function internal.propose_frontend_report_restriction(uuid,integer,text,uuid,text,text,integer,boolean) from public,anon,authenticated,service_role;

create or replace function internal.approve_decision(p_decision_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := internal.staff_actor('decision:approve'); d private.decisions; c private.evidence_cases; case_id uuid; subject uuid;
begin
  select x.case_id,e.subject_id into case_id,subject from private.decisions x join private.evidence_cases e on e.id=x.case_id where x.id=p_decision_id;
  if not found then raise exception 'decision not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id=case_id for update;
  select * into d from private.decisions x where x.id = p_decision_id for update;
  if not found or d.status <> 'proposed' then raise exception 'decision not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('decision:approve');
  if actor in (d.proposed_by, c.subject_id) then
    raise exception 'a second, independent approver is required' using errcode = '42501';
  end if;
  if c.version is distinct from d.case_version or c.status <> 'open'
    or internal.evidence_case_snapshot(c.id) is distinct from d.reviewed_snapshot then
    raise exception 'case changed after proposal' using errcode = 'PT409';
  end if;
  -- 20261125174942: checked again at approval, in case the person became an
  -- admin after the proposal.
  if d.action = 'restrict_account' and exists(select 1 from private.staff_roles s
      where s.user_id = c.subject_id and s.role = 'admin' and s.revoked_at is null) then
    raise exception 'End this person''s admin role first' using errcode = 'PT409', detail = 'subject_is_admin';
  end if;
  update private.decisions set status = 'approved', approved_by = actor, approved_at = statement_timestamp()
  where id = d.id;
  update private.evidence_cases set status = 'decided', version = version + 1, claimed_by = null, claim_expires_at = null,claim_nonce=null
  where id = c.id;
  return jsonb_build_object('decision_id', d.id, 'status', 'approved');
end;
$$;
revoke all on function internal.approve_decision(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.approve_decision(uuid) to authenticated;
commit;
