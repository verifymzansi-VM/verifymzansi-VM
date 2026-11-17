-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_frontend_cipc_parse(p_actor uuid, p_session uuid, p_artifact uuid, p_summary jsonb, p_directors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare case_id uuid;x private.frontend_business_checks;e private.frontend_cipc_documents;c private.evidence_cases;
  d private.frontend_cipc_reviews;match_fingerprint text;match_position text;receipt jsonb;now_at timestamptz;
begin
  if p_summary is null or jsonb_typeof(p_summary)<>'object' or octet_length(p_summary::text)>50000
    or exists(select 1 from jsonb_object_keys(p_summary) k where k not in('registrationNumber','registeredName','enterpriseStatus','issuedOn','docType','registeredOffice','registeredOfficeLines','cipcReference','findings'))
    or p_directors is null or jsonb_typeof(p_directors)<>'array' or jsonb_array_length(p_directors)>100
    or octet_length(p_directors::text)>35000
    then raise exception 'validated CIPC parse receipt required' using errcode='22023';end if;
  select check_id into case_id from private.frontend_cipc_documents where artifact_id=p_artifact and actor_id=p_actor;
  if case_id is null then raise exception 'CIPC upload unavailable' using errcode='PT404';end if;
  x:=internal.lock_frontend_cipc_case(case_id);now_at:=clock_timestamp();
  select * into e from private.frontend_cipc_documents where artifact_id=p_artifact and actor_id=p_actor for update;
  select * into d from private.frontend_cipc_reviews where check_id=x.id for update;
  select * into c from private.evidence_cases where id=x.id;
  if e.artifact_id is null or e.reviewed_version<>x.updated_at or not exists(
    select 1 from auth.sessions s join private.current_account_access a on a.id=s.user_id where s.id=p_session and s.user_id=p_actor
      and (s.not_after is null or s.not_after>now_at) and (e.source='owner_upload' or s.aal='aal2'))
    then raise exception 'current CIPC upload scope required' using errcode='PT409';end if;
  if e.source='admin_copy' and (c.claimed_by is distinct from p_actor or c.claim_generation::text<>e.claim_generation
    or c.claim_nonce is distinct from e.claim_nonce or c.claim_expires_at<=now_at
    or not exists(select 1 from private.staff_roles r join private.staff_capabilities a on a.role=r.role and a.capability='evidence:view'
      where r.user_id=p_actor and r.revoked_at is null)
    or not exists(select 1 from auth.mfa_factors f where f.user_id=p_actor and f.factor_type='totp' and f.status='verified'))
    then raise exception 'current official copy claim required' using errcode='42501';end if;
  if not exists(select 1 from private.evidence_artifacts a where a.id=e.artifact_id and a.case_id=x.id and a.owner_id=x.owner_id
      and a.state='clean' and a.purpose='registration' and a.content_sha256=e.content_digest)
    then raise exception 'stored CIPC PDF receipt required' using errcode='PT409';end if;
  if e.source='admin_copy' and (p_summary->>'registrationNumber' is null or p_summary->>'registeredName' is null
    or p_summary->>'docType' is null or p_summary->>'docType'='unknown')
    then raise exception 'readable official CIPC disclosure required' using errcode='22023';end if;
  select f.identity_hmac,coalesce(nullif(btrim(p.value->>'role'),''),'Director') into match_fingerprint,match_position
    from jsonb_array_elements(p_directors) p(value) join private.accepted_identity_facts f on f.owner_id=x.owner_id
    and f.identity_hmac=p.value->>'fingerprint' and f.revoked_at is null
    where internal.frontend_business_identity_reviewed(x.owner_id) limit 1;
  receipt:=p_summary||jsonb_build_object('directors',coalesce((select jsonb_agg(jsonb_build_object(
    'name',internal.privacy_text(p.value->>'name',1,250),'role',left(p.value->>'role',120),
    'hasSaId',p.value->>'fingerprint' is not null,'isOwner',coalesce(p.value->>'fingerprint'=match_fingerprint,false))
    order by p.n) from jsonb_array_elements(p_directors) with ordinality p(value,n)),'[]'::jsonb));
  update private.frontend_cipc_documents set summary=receipt,recorded_at=now_at,owner_match_fingerprint=match_fingerprint,
    owner_match_position=left(match_position,120) where artifact_id=e.artifact_id;
  if e.source='admin_copy' then update private.frontend_cipc_reviews set official_file=e.artifact_id where check_id=x.id;
  else
    update private.frontend_cipc_reviews set owner_file=e.artifact_id,official_file=null,office_override=null,submitted_at=coalesce(submitted_at,now_at) where check_id=x.id;
  end if;
  update private.frontend_business_checks set status='pending',updated_at=now_at where id=x.id;
  return jsonb_build_object('caseId',x.id,'status','pending','updatedAt',now_at);
end$function$;
alter function internal.record_frontend_cipc_parse(uuid,uuid,uuid,jsonb,jsonb) owner to postgres;
revoke all on function internal.record_frontend_cipc_parse(uuid,uuid,uuid,jsonb,jsonb) from public;
grant execute on function internal.record_frontend_cipc_parse(uuid,uuid,uuid,jsonb,jsonb) to service_role;
