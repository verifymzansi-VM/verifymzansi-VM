-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.execute_frontend_report_action_v2(p_report uuid, p_expected_revision integer, p_claim_generation text, p_claim_nonce uuid, p_action text, p_reason text, p_duration_days integer DEFAULT NULL::integer, p_emergency boolean DEFAULT false, p_expected_post_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid;subject uuid;target uuid;post private.posts;r private.reports;q private.queue_claims;
  prior private.frontend_report_action_receipts;state private.frontend_post_hold_state;reason text;receipt uuid:=gen_random_uuid();answer jsonb;
begin
  if p_action in('suspend','ban') then return internal.propose_frontend_report_restriction(p_report,p_expected_revision,p_claim_generation,p_claim_nonce,p_action,p_reason,p_duration_days,p_emergency);end if;
  if p_action is distinct from 'hide' then return internal.execute_frontend_report_action(p_report,p_expected_revision,p_claim_generation,p_claim_nonce,p_action,p_reason,p_duration_days,p_emergency);end if;
  actor:=internal.staff_actor('content:hide');perform internal.staff_actor('report:resolve');
  if p_expected_post_revision is null or p_expected_post_revision<1 or p_duration_days is not null or p_emergency is distinct from false then raise exception 'represented target revision required' using errcode='22023';end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid hide reason required' using errcode='22023';end if;
  select subject_account_id,post_id into subject,target from private.reports where id=p_report;
  if not found or target is null then raise exception 'reported content is unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into post from private.posts where id=target for update;
  select * into r from private.reports where id=p_report for update;
  actor:=internal.staff_actor('content:hide');perform internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor,null,p_report) or post.owner_id is distinct from subject then raise exception 'independent report subject required' using errcode='42501';end if;
  select * into prior from private.frontend_report_action_receipts x where x.report_id=p_report and x.expected_revision=p_expected_revision;
  if found then
    if prior.actor_id=actor and prior.action=p_action and prior.reason=reason and prior.target_post_revision=p_expected_post_revision
      and prior.claim_generation::text=p_claim_generation and prior.claim_nonce_digest=encode(sha256(convert_to(p_claim_nonce::text,'UTF8')),'hex')
      and prior.acknowledged_until>clock_timestamp() and r.status='resolved' and r.resolved_by=actor and r.resolution_note=reason
      and exists(select 1 from private.frontend_content_holds h where h.id=prior.id and h.released_at is null) then
      return jsonb_build_object('report_id',r.id,'action','hide','status','applied','reused',true);
    end if;
    raise exception 'hide receipt changed' using errcode='PT409';
  end if;
  if r.status<>'open' or r.revision is distinct from p_expected_revision or r.post_id is distinct from target
    or post.revision<>p_expected_post_revision or post.status not in('live','paused') or post.edit_of is not null or post.revision>=2147483647 then raise exception 'reviewed report or target changed' using errcode='PT409';end if;
  select * into q from private.queue_claims where report_id=r.id for update;
  perform internal.assert_queue_claim(q,actor,p_claim_generation,p_claim_nonce);
  select * into state from private.frontend_post_hold_state where post_id=post.id for update;
  if not found then
    insert into private.frontend_post_hold_state(post_id,prior_status,prior_reason,hidden_revision)
      values(post.id,post.status,post.status_reason,post.revision+1);
  else
    update private.frontend_post_hold_state set content_changed=content_changed or hidden_revision<>post.revision,hidden_revision=post.revision+1 where post_id=post.id;
  end if;
  update private.posts set status='paused',status_reason='staff_hidden',revision=revision+1 where id=post.id;
  update private.post_search_documents set is_visible=false where post_id=post.id;
  answer:=internal.resolve_report(r.id,p_claim_generation,p_claim_nonce,'resolved',reason);
  if answer->>'status' is distinct from 'resolved' then raise exception 'report closure not confirmed' using errcode='PT409';end if;
  insert into private.frontend_report_action_receipts(id,report_id,expected_revision,claim_generation,claim_nonce_digest,actor_id,action,reason,emergency,status,acknowledged_until,target_post_revision)
    values(receipt,r.id,p_expected_revision,q.claim_generation,encode(sha256(convert_to(q.claim_nonce::text,'UTF8')),'hex'),actor,'hide',reason,false,'applied',q.claim_expires_at,p_expected_post_revision);
  insert into private.frontend_content_holds(id,post_id,account_id,actor_id,reporter_id,reason,applied_at)
      values(receipt,post.id,subject,actor,r.reporter_id,reason,clock_timestamp());
  perform internal.staff_actor('content:hide');perform internal.staff_actor('report:resolve');
  return jsonb_build_object('report_id',r.id,'action','hide','status','applied');
end$function$;
alter function internal.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) owner to postgres;
revoke all on function internal.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) from public;
grant execute on function internal.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) to authenticated;
