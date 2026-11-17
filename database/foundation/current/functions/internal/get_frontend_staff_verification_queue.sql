-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_verification_queue(p_limit integer DEFAULT 100, p_include_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim');result jsonb;rows jsonb;total bigint;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_include_ids is null or cardinality(p_include_ids)>300 then raise exception 'bounded identity queue required' using errcode='22023';end if;
  with ready as(select c.id,c.subject_id,c.version,c.claim_generation,c.claim_nonce,c.claimed_by,c.claim_expires_at,
      s.id submission_id,s.id_artifact_id,s.selfie_artifact_id,s.created_at,s.risk_score,p.display_name,
      row_number() over(order by s.risk_score desc,s.created_at,c.id) n
      from private.evidence_cases c join private.verification_current_submissions v on v.case_id=c.id
      join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
      join private.profiles p on p.account_id=c.subject_id
      where c.kind='kyc' and c.status='open' and c.subject_id<>actor
      and exists(select 1 from private.current_account_access u where u.id=c.subject_id)
  )
  select coalesce((select jsonb_agg(jsonb_build_object('case_id',r.id,'owner_id',r.subject_id,'version',r.version,'display_name',r.display_name,
      'created_at',r.created_at,'steps',internal.frontend_identity_queue_steps(r.id),
      'review_scope',case when r.claimed_by=actor and r.claim_expires_at>statement_timestamp() then jsonb_build_object(
        'caseId',r.id,'caseVersion',r.version,'submissionId',r.submission_id,'claimGeneration',r.claim_generation::text,'claimNonce',r.claim_nonce) end) order by r.risk_score desc,r.created_at,r.id)
      from (select * from ready where n<=p_limit or id=any(p_include_ids) or claimed_by=actor and claim_expires_at>statement_timestamp() order by n limit 1401) r),'[]'::jsonb),
    2*(select count(*) from ready)-(select count(*) from private.frontend_identity_step_approvals a join ready r on r.submission_id=a.submission_id
      where a.final_result is null and a.matches and a.case_version=r.version and a.claim_generation=r.claim_generation
      and a.reviewer_id=r.claimed_by and r.claim_expires_at>statement_timestamp()
      and a.claim_nonce_digest=encode(sha256(convert_to(r.claim_nonce::text,'UTF8')),'hex')
      and a.artifact_id=(case a.purpose when 'id_front' then r.id_artifact_id else r.selfie_artifact_id end))
    into rows,total;
  if jsonb_array_length(rows)>1400 then raise exception 'narrow the identity queue selection' using errcode='PT409';end if;
  perform internal.staff_actor('case:claim');
  return jsonb_build_object('account_id',actor,'total_steps',total,'groups',rows);
end$function$;
alter function internal.get_frontend_staff_verification_queue(integer,uuid[]) owner to postgres;
revoke all on function internal.get_frontend_staff_verification_queue(integer,uuid[]) from public;
grant execute on function internal.get_frontend_staff_verification_queue(integer,uuid[]) to authenticated;
