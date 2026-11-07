-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_identity_queue_steps(p_case uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'step_type',case a.purpose when 'id_front' then 'id_doc' else 'selfie' end,
    'created_at',s.created_at,'updated_at',s.created_at,'reviewed_at',null,
    'risk_score',s.risk_score,'risk_level',case when s.risk_score>50 then 'high' else 'low' end,
    'auto_status',case when r.final_result->>'status'='awaiting_second_reviewer' then 'awaiting_second_reviewer' else 'manual_review' end)
    order by case a.purpose when 'id_front' then 0 else 1 end),'[]'::jsonb)
    from private.evidence_cases c join private.verification_current_submissions v on v.case_id=c.id
    join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
    join private.evidence_artifacts a on a.id in(s.id_artifact_id,s.selfie_artifact_id)
    left join private.frontend_identity_step_approvals r on r.submission_id=s.id and r.artifact_id=a.id
      and r.case_version=c.version and r.claim_generation=c.claim_generation and r.reviewer_id=c.claimed_by
      and r.claim_nonce_digest=encode(sha256(convert_to(c.claim_nonce::text,'UTF8')),'hex')
      and c.claim_expires_at>statement_timestamp()
    where c.id=p_case and not(r.matches is true and r.final_result is null);
$function$;
alter function internal.frontend_identity_queue_steps(uuid) owner to postgres;
revoke all on function internal.frontend_identity_queue_steps(uuid) from public;
