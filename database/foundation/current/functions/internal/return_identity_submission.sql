-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.return_identity_submission(p_case uuid, p_expected_version integer, p_claim_generation text, p_claim_nonce uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('verification:decide_routine'); c private.evidence_cases; subject uuid; reason text; returned uuid;
begin
  reason:=internal.retention_reason(p_reason);
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_case for update;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  if c.version<>p_expected_version or c.version>=2147483647 or c.subject_id=actor
    or exists(select 1 from private.decisions d where d.case_id=c.id and d.status='proposed') then raise exception 'reviewed case changed' using errcode='PT409'; end if;
  update private.evidence_cases set version=version+1,claimed_by=null,claim_expires_at=null,claim_nonce=null where id=c.id returning * into c;
  update private.evidence_artifacts set retain_until=statement_timestamp()+interval '90 days' where case_id=c.id and state in('clean','uploaded','rejected') and retain_until is null;
  insert into private.verification_return_requests(case_id,case_version,reason,reviewer_id) values(c.id,c.version,reason,actor) returning id into returned;
  -- The member is told: a notice in the account and an email. Neither carries
  -- the reason or any identity detail; the member reads the reason on the
  -- verification page after signing in.
  if c.kind='kyc' then
    perform internal.notify_account(c.subject_id,'verification_returned',returned,null,null);
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('verification_returned',returned,c.subject_id,'verification_returned:'||returned);
  end if;
  return jsonb_build_object('case_id',c.id,'version',c.version,'status','needs_resubmission');
end;
$function$;
alter function internal.return_identity_submission(uuid,integer,text,uuid,text) owner to postgres;
revoke all on function internal.return_identity_submission(uuid,integer,text,uuid,text) from public;
grant execute on function internal.return_identity_submission(uuid,integer,text,uuid,text) to authenticated;
