-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.decide_frontend_cipc(p_case uuid, p_expected timestamp with time zone, p_action text, p_generation text, p_nonce uuid, p_note text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_confirmed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('verification:decide_routine');x private.frontend_business_checks;c private.evidence_cases;
  d private.frontend_cipc_reviews;doc private.frontend_cipc_documents;root private.frontend_current_cipc_stickers;exception_row private.frontend_cipc_exceptions;
  now_at timestamptz;new_status text;note_text text;name text;role_text text;position_text text;office jsonb;expiry timestamptz;
begin
  if p_action is null or p_action not in('approve','reject','request_info','propose_exception','confirm_exception','withdraw_exception')
    or (p_reason is not null and p_reason !~ '^[a-z0-9_]{1,80}$')
    then raise exception 'valid CIPC decision required' using errcode='22023';end if;
  if nullif(btrim(p_note),'') is not null then note_text:=internal.privacy_text(p_note,1,1000);end if;
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.staff_actor('verification:decide_routine');now_at:=clock_timestamp();
  if actor=x.owner_id then raise exception 'independent reviewer required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected or x.status<>'pending' then raise exception 'represented CIPC case changed' using errcode='PT409';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  select * into d from private.frontend_cipc_reviews where check_id=x.id for update;
  if d.submitted_at is null then raise exception 'owner intake is not yet confirmed' using errcode='PT409';end if;
  if p_action='withdraw_exception' then
    select * into exception_row from private.frontend_cipc_exceptions where check_id=x.id for update;
    if not found or exception_row.confirmed_at is not null then raise exception 'no current exception proposal' using errcode='PT409';end if;
    if exception_row.proposed_by<>actor then perform internal.staff_actor('decision:approve');end if;
    delete from private.frontend_cipc_exceptions where check_id=x.id;
    update private.frontend_business_checks set updated_at=now_at where id=x.id;
    update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
    return jsonb_build_object('caseId',x.id,'status','pending');
  end if;
  if p_action='request_info' then
    note_text:=internal.privacy_text(p_note,1,1000);
    insert into private.frontend_business_check_messages(check_id,author_id,author_role,body) values(x.id,actor,'staff',note_text);
    update private.frontend_business_checks set status='info_requested',updated_at=now_at where id=x.id;
    update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
    perform internal.staff_actor('verification:decide_routine');return jsonb_build_object('caseId',x.id,'status','info_requested');
  end if;
  if p_action in('approve','propose_exception','confirm_exception') then
    if p_action='approve' and x.kind<>'cipc_link' and p_confirmed is distinct from true
      then raise exception 'confirm the official review findings' using errcode='22023';end if;
    if p_action<>'approve' and (x.kind<>'cipc' or d.route<>'director')
      then raise exception 'director name exception is unavailable for this case' using errcode='PT409';end if;
    perform pg_advisory_xact_lock(hashtextextended(d.registration_number,6509));
    if not internal.frontend_business_identity_reviewed(x.owner_id) or not exists(select 1 from private.current_account_access a where a.id=x.owner_id)
      then raise exception 'current reviewed owner required' using errcode='PT409';end if;
    if exists(select 1 from private.frontend_current_cipc_stickers s where s.registration_number=d.registration_number and s.owner_id<>x.owner_id)
      then raise exception 'another owner already has this registration' using errcode='PT409';end if;
    if x.kind='cipc_link' then
      select * into root from private.frontend_current_cipc_stickers s where s.business_id=d.linked_business_id and s.owner_id=x.owner_id
        and s.registration_number=d.registration_number and s.kind='cipc';
      if not found then raise exception 'source CIPC sticker changed or expired' using errcode='PT409';end if;
      name:=root.registered_name;role_text:=root.accepted_role;position_text:=root.position_title;office:=root.registered_office;expiry:=root.expires_at;
    else
      select e.* into doc from private.frontend_cipc_documents e join private.evidence_artifacts a on a.id=e.artifact_id
        where e.artifact_id=d.official_file and e.check_id=x.id and e.source='admin_copy' and e.actor_id<>x.owner_id
          and e.recorded_at is not null and a.state='clean' and a.content_sha256=e.content_digest
          and (a.retain_until is null or a.retain_until>now_at);
      if not found or doc.summary->>'registrationNumber' is distinct from d.registration_number
        or lower(btrim(doc.summary->>'enterpriseStatus')) is distinct from 'in business'
        then raise exception 'a matching current official CIPC copy showing In Business is required' using errcode='PT409';end if;
      name:=internal.privacy_text(doc.summary->>'registeredName',2,250);
      office:=coalesce(d.office_override,nullif(doc.summary->'registeredOffice','null'::jsonb));
      if p_action='propose_exception' then
        note_text:=internal.privacy_text(p_note,10,1000);
        if not internal.frontend_cipc_legal_name_match(x.owner_id,doc.summary)
          then raise exception 'the official copy must uniquely match the verified owner name' using errcode='PT409';end if;
        if exists(select 1 from private.frontend_cipc_exceptions e where e.check_id=x.id and e.official_file=doc.artifact_id)
          then raise exception 'an exception is already waiting for review' using errcode='PT409';end if;
        insert into private.frontend_cipc_exceptions(check_id,official_file,proposed_by,reason)
          values(x.id,doc.artifact_id,actor,note_text)
          on conflict(check_id) do update set official_file=excluded.official_file,proposed_by=excluded.proposed_by,
            reason=excluded.reason,proposed_at=now_at,confirmed_by=null,confirmed_at=null;
        update private.frontend_business_checks set updated_at=now_at where id=x.id;
        update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
        perform internal.staff_actor('verification:decide_routine');return jsonb_build_object('caseId',x.id,'status','pending');
      end if;
      if p_action='confirm_exception' then
        perform internal.staff_actor('decision:approve');
        select * into exception_row from private.frontend_cipc_exceptions where check_id=x.id and official_file=doc.artifact_id and confirmed_at is null for update;
        if not found or not internal.frontend_cipc_legal_name_match(x.owner_id,doc.summary)
          then raise exception 'represented exception or evidence changed' using errcode='PT409';end if;
        if exception_row.proposed_by=actor then raise exception 'a different senior reviewer must confirm' using errcode='42501';end if;
        update private.frontend_cipc_exceptions set confirmed_by=actor,confirmed_at=now_at where check_id=x.id;
      end if;
      if d.route='representative' then
        if d.representative_verified_at is null or not d.domain_confirmed or not d.callback_confirmed
          then raise exception 'work email and independent callback required' using errcode='PT409';end if;
        role_text:='representative';position_text:=d.representative_position;
      else
        if p_action<>'confirm_exception' and (doc.owner_match_fingerprint is null or not exists(select 1 from private.accepted_identity_facts f
          where f.owner_id=x.owner_id and f.identity_hmac=doc.owner_match_fingerprint and f.revoked_at is null)
          ) then raise exception 'reviewed owner does not match a director on the official copy' using errcode='PT409';end if;
        role_text:=case when doc.owner_match_position ilike '%member%' then 'member' else 'director' end;
        position_text:=doc.owner_match_position;
      end if;
      expiry:=now_at+interval '365 days';
    end if;
    update private.frontend_cipc_reviews set registered_name=name,accepted_role=role_text,position_title=position_text,registered_office=office where check_id=x.id;
    if x.kind='cipc' and d.use_registered_office then perform internal.apply_frontend_registered_office(x.business_id,x.owner_id,office);end if;
    new_status:='approved';
  else new_status:='rejected';end if;
  update private.frontend_business_checks set status=new_status,review_note=note_text,reviewed_by=actor,reason_code=p_reason,
    decided_at=now_at,updated_at=now_at,expires_at=expiry where id=x.id;
  update private.evidence_cases set status='decided',claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
  update private.evidence_artifacts set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),now_at+interval '30 days')
    where case_id=x.id and state='clean';
  perform internal.staff_actor('verification:decide_routine');
  return jsonb_build_object('caseId',x.id,'status',new_status);
end$function$;
alter function internal.decide_frontend_cipc(uuid,timestamp with time zone,text,text,uuid,text,text,boolean) owner to postgres;
revoke all on function internal.decide_frontend_cipc(uuid,timestamp with time zone,text,text,uuid,text,text,boolean) from public;
grant execute on function internal.decide_frontend_cipc(uuid,timestamp with time zone,text,text,uuid,text,text,boolean) to authenticated;
