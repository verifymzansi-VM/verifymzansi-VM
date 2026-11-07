-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.execute_frontend_report_action(p_report uuid, p_expected_revision integer, p_claim_generation text, p_claim_nonce uuid, p_action text, p_reason text, p_duration_days integer DEFAULT NULL::integer, p_emergency boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('report:resolve');r private.reports;q private.queue_claims;prior private.frontend_report_action_receipts;reason text;answer jsonb;receipt uuid:=gen_random_uuid();outcome text;final_status text;
begin
  if p_action is null or p_action not in('dismiss','warn','hide','suspend','ban') or p_expected_revision is null or p_expected_revision<1 or p_emergency is null then raise exception 'represented report action required' using errcode='22023';end if;
  -- Additional enforcement effects are integrated separately; an unimplemented
  -- action must never receive a successful native acknowledgement.
  if p_action not in('dismiss','warn') then raise exception 'native report enforcement integration is pending' using errcode='0A000';end if;
  if p_duration_days is not null or p_emergency then raise exception 'this action has no suspension parameters' using errcode='22023';end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid review reason required' using errcode='22023';end if;
  if p_action='warn' and length(reason)<10 then raise exception 'warning reason needs at least 10 characters' using errcode='22023';end if;
  outcome:=case p_action when 'dismiss' then 'dismissed' else 'resolved' end;
  final_status:=case p_action when 'dismiss' then 'dismissed' else 'applied' end;
  select * into r from private.reports where id=p_report for update;
  if not found then raise exception 'report unavailable' using errcode='PT409';end if;
  actor:=internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor,null,p_report) then raise exception 'self-review is not allowed' using errcode='42501';end if;
  select * into prior from private.frontend_report_action_receipts x where x.report_id=p_report and x.expected_revision=p_expected_revision;
  if found then
    if prior.actor_id=actor and prior.action=p_action and prior.reason=reason and prior.claim_generation::text=p_claim_generation
      and prior.claim_nonce_digest=encode(sha256(convert_to(p_claim_nonce::text,'UTF8')),'hex') and prior.acknowledged_until>clock_timestamp()
      and r.status=outcome and r.resolved_by=actor and r.resolution_note=reason
      and (p_action='dismiss' or exists(select 1 from private.frontend_account_warnings w where w.receipt_id=prior.id and w.account_id=r.subject_account_id)) then
      return jsonb_build_object('report_id',r.id,'action',p_action,'status',prior.status,'reused',true);
    end if;
    raise exception 'report action receipt changed' using errcode='PT409';
  end if;
  if r.revision<>p_expected_revision or r.status<>'open' then raise exception 'report changed since review' using errcode='PT409';end if;
  select * into q from private.queue_claims where report_id=r.id for update;
  perform internal.assert_queue_claim(q,actor,p_claim_generation,p_claim_nonce);
  if p_action='warn' and (exists(select 1 from private.account_closures c where c.user_id=r.subject_account_id) or not exists(select 1 from auth.users u where u.id=r.subject_account_id and u.deleted_at is null)) then raise exception 'report subject is closed' using errcode='PT409';end if;
  answer:=internal.resolve_report(r.id,p_claim_generation,p_claim_nonce,outcome,reason);
  if answer->>'id' is distinct from r.id::text or answer->>'status' is distinct from outcome then raise exception 'native report outcome could not be confirmed' using errcode='PT409';end if;
  insert into private.frontend_report_action_receipts(id,report_id,expected_revision,claim_generation,claim_nonce_digest,actor_id,action,reason,duration_days,emergency,status,acknowledged_until)
    values(receipt,r.id,p_expected_revision,q.claim_generation,encode(sha256(convert_to(q.claim_nonce::text,'UTF8')),'hex'),actor,p_action,reason,null,false,final_status,q.claim_expires_at);
  if p_action='warn' then
    insert into private.frontend_account_warnings(receipt_id,account_id) values(receipt,r.subject_account_id);
    insert into private.notifications(account_id,kind,subject_id) values(r.subject_account_id,'account_warning',receipt);
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('account_warning',receipt,r.subject_account_id,'account_warning:'||receipt);
    perform internal.signal_owner_inbox(r.subject_account_id);
  end if;
  perform internal.staff_actor('report:resolve');
  return jsonb_build_object('report_id',r.id,'action',p_action,'status',final_status);
end$function$;
alter function internal.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) owner to postgres;
revoke all on function internal.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) from public;
grant execute on function internal.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) to authenticated;
