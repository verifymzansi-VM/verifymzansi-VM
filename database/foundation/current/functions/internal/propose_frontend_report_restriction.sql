-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.propose_frontend_report_restriction(p_report uuid, p_expected_revision integer, p_generation text, p_nonce uuid, p_action text, p_reason text, p_days integer, p_emergency boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.propose_frontend_report_restriction(uuid,integer,text,uuid,text,text,integer,boolean) owner to postgres;
revoke all on function internal.propose_frontend_report_restriction(uuid,integer,text,uuid,text,text,integer,boolean) from public;
