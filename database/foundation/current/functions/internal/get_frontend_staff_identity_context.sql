-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_identity_context(p_owner uuid DEFAULT NULL::uuid, p_artifact uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view');c private.evidence_cases;found_ids uuid[];result jsonb;profile jsonb;accesses jsonb;
begin
  if p_owner is null and p_artifact is null then raise exception 'identity subject required' using errcode='22023';end if;
  select array_agg(e.id) into found_ids from private.evidence_cases e
    join private.verification_current_submissions v on v.case_id=e.id
    join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=e.version
    where e.kind='kyc' and e.status='open' and e.claimed_by=actor and e.claim_expires_at>clock_timestamp()
    and e.subject_id<>actor and (p_owner is null or e.subject_id=p_owner)
    and (p_artifact is null or p_artifact in(s.id_artifact_id,s.selfie_artifact_id));
  if coalesce(array_length(found_ids,1),0)<>1 then raise exception 'one current independent held case required' using errcode='42501';end if;
  select * into c from private.evidence_cases where id=found_ids[1];
  result:=internal.staff_identity_review_context(c.id,c.claim_generation::text,c.claim_nonce);
  if p_artifact is not null and p_artifact not in((result->>'id_artifact_id')::uuid,(result->>'selfie_artifact_id')::uuid) then
    raise exception 'reviewed submission changed' using errcode='PT409';end if;
  -- The profile context and recent access facts are purpose-bound to this same
  -- independently held case. Direct RPC access is audited too.
  perform internal.staff_evidence_metadata(c.id,c.claim_generation::text,c.claim_nonce,'routine_review');
  select jsonb_build_object('display_name',p.display_name,
    'account_verification_status',case when internal.current_verified_identity(c.subject_id) is not null then 'verified' else 'pending_review' end,
    'account_status',case when exists(select 1 from private.account_closures x where x.user_id=c.subject_id) then 'closed'
      when exists(select 1 from private.current_account_access a where a.id=c.subject_id) then 'active' else 'restricted' end,
    'strikes',null,'legal_hold',exists(select 1 from private.legal_holds h where h.subject_id=c.subject_id and h.released_at is null),
    'location_province',pr.label,'location_city',ci.label) into profile
    from private.profiles p left join private.verification_localities l on l.owner_id=p.account_id
    left join private.provinces pr on pr.id=l.province_id left join private.cities ci on ci.id=l.city_id where p.account_id=c.subject_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id::text||':'||a.id::text,'actor_id',l.staff_id,
    'actor_role','Not recorded','artifact_id',a.id,'ip_hash',null,'accessed_at',l.accessed_at,'purpose',l.purpose)
    order by l.accessed_at desc,l.id desc,a.id),'[]'::jsonb) into accesses
    from(select x.* from private.evidence_access_log x where x.case_id=c.id and x.case_version=(result->>'case_version')::integer
      order by x.accessed_at desc,x.id desc limit 100) l cross join lateral unnest(l.artifact_ids) a(id)
    where a.id in((result->>'id_artifact_id')::uuid,(result->>'selfie_artifact_id')::uuid);
  perform internal.staff_actor('evidence:view');
  return result||jsonb_build_object('reviewer_id',actor,'owner_id',c.subject_id,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at',c.claim_expires_at,'owner_profile',profile,'access_log',accesses);
end$function$;
alter function internal.get_frontend_staff_identity_context(uuid,uuid) owner to postgres;
revoke all on function internal.get_frontend_staff_identity_context(uuid,uuid) from public;
grant execute on function internal.get_frontend_staff_identity_context(uuid,uuid) to authenticated;
