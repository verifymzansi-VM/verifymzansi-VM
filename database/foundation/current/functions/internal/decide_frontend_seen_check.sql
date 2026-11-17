-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.decide_frontend_seen_check(p_case uuid, p_expected timestamp with time zone, p_action text, p_generation text, p_nonce uuid, p_note text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('verification:decide_routine');x private.frontend_business_checks;c private.evidence_cases;
  now_at timestamptz;new_status text;notes text;city text;
begin
  if p_action is null or p_action not in('approve','reject','request_info') or (p_reason is not null and p_reason !~ '^[a-z0-9_]{1,80}$')
    then raise exception 'valid seen decision required' using errcode='22023';end if;
  if nullif(btrim(p_note),'') is not null then notes:=internal.privacy_text(p_note,1,1000);end if;
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('verification:decide_routine');now_at:=clock_timestamp();
  if actor=x.owner_id or (p_action='approve' and actor in(x.assigned_to,x.report_by))
    then raise exception 'an independent staff reviewer is required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected then raise exception 'business check changed' using errcode='PT409';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  if p_action='request_info' then
    notes:=internal.privacy_text(p_note,1,1000);
    insert into private.frontend_business_check_messages(check_id,author_id,author_role,body) values(x.id,actor,'staff',notes);
    update private.frontend_business_checks set status='info_requested',updated_at=now_at where id=x.id;
    update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
    perform internal.staff_actor('verification:decide_routine');
    return jsonb_build_object('caseId',x.id,'status','info_requested');
  end if;
  if p_action='approve' then
    if x.report_by is null or x.report_by is distinct from x.assigned_to
      or x.visit_report->>'outcome' is distinct from 'seen' or x.visit_report->>'identityConfirmed' is distinct from 'true'
      or not internal.frontend_business_identity_reviewed(x.owner_id)
      or (select count(*) from private.frontend_business_seen_photos p join private.evidence_artifacts a on a.id=p.artifact_id
        where p.check_id=x.id and p.verifier_id=x.report_by and a.state='clean' and a.content_sha256=p.content_digest)<3
      then raise exception 'confirmed identity and three current photographs required' using errcode='PT409';end if;
    if x.seen_method='visit' then
      select coalesce((select y.label from private.cities y where y.province_id=p.province_id
          and lower(y.label)=lower(x.visit_report->>'city') order by y.id limit 1),city_ref.label)
      into city from private.posts p left join private.cities city_ref on city_ref.id=p.city_id where p.id=x.business_id;
    end if;
    new_status:='approved';
  else new_status:='rejected';end if;
  update private.frontend_business_checks set status=new_status,review_note=notes,reviewed_by=actor,public_city=city,reason_code=p_reason,
    decided_at=now_at,updated_at=now_at,expires_at=case when new_status='approved' then now_at+interval '365 days' end where id=x.id;
  update private.evidence_cases set status='decided',claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
  update private.evidence_artifacts set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),now_at+interval '30 days')
    where case_id=x.id and state='clean';
  perform internal.staff_actor('verification:decide_routine');
  return jsonb_build_object('caseId',x.id,'status',new_status);
end$function$;
alter function internal.decide_frontend_seen_check(uuid,timestamp with time zone,text,text,uuid,text,text) owner to postgres;
revoke all on function internal.decide_frontend_seen_check(uuid,timestamp with time zone,text,text,uuid,text,text) from public;
grant execute on function internal.decide_frontend_seen_check(uuid,timestamp with time zone,text,text,uuid,text,text) to authenticated;
