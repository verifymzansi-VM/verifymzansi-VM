-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.register_identity_submission(p_case uuid, p_expected_version integer, p_id_artifact uuid, p_selfie_artifact uuid, p_fingerprint text, p_identity_key text, p_encrypted_number jsonb, p_receipt uuid, p_risk_score integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare c private.evidence_cases; s private.verification_identity_submissions; subject uuid;
begin
  if p_expected_version is null or p_expected_version not between 1 and 2147483646
    or p_fingerprint is null or p_fingerprint !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
    or p_identity_key is distinct from 'identity-match-v1' or p_receipt is null
    or p_risk_score is null or p_risk_score not between 0 and 100
    or p_encrypted_number is null or jsonb_typeof(p_encrypted_number)<>'object'
    or jsonb_typeof(p_encrypted_number->'ciphertext') is distinct from 'string'
    or jsonb_typeof(p_encrypted_number->'iv') is distinct from 'string'
    or jsonb_typeof(p_encrypted_number->'tag') is distinct from 'string'
    or jsonb_typeof(p_encrypted_number->'key_id') is distinct from 'string'
    or not(p_encrypted_number ?& array['ciphertext','iv','tag','key_id'])
    or p_encrypted_number-array['ciphertext','iv','tag','key_id']<>'{}'::jsonb
    or p_encrypted_number->>'ciphertext' !~ '^[a-f0-9]{26}$'
    or p_encrypted_number->>'iv' !~ '^[a-f0-9]{24}$' or p_encrypted_number->>'tag' !~ '^[a-f0-9]{32}$'
    or p_encrypted_number->>'key_id' is distinct from 'identity-number-v1' then
    raise exception 'bound processing receipt required' using errcode='22023'; end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_case;
  if c.kind<>'kyc' or not exists(select 1 from private.current_account_access a where a.id=subject) then
    raise exception 'active identity case required' using errcode='42501'; end if;
  if exists(select 1 from private.accepted_identity_facts f where f.owner_id=subject) then
    raise exception 'accepted identity requires authorised resubmission' using errcode='PT409'; end if;
  if c.status<>'open' then raise exception 'open identity case required' using errcode='42501'; end if;
  if exists(select 1 from private.decisions d where d.case_id=c.id and d.status='proposed'
    and d.action='approve_override' and d.payload ? 'identity_submission_id') then
    raise exception 'independent identity review is pending' using errcode='PT409'; end if;
  select x.* into s from private.verification_identity_submissions x where x.receipt_id=p_receipt;
  if found then
    if (s.case_id,s.owner_id,s.case_version,s.id_artifact_id,s.selfie_artifact_id,s.identity_hmac,s.identity_key_id,
        s.number_ciphertext,s.number_iv,s.number_tag,s.encryption_key_id,s.risk_score)
      is distinct from (c.id,subject,p_expected_version+1,p_id_artifact,p_selfie_artifact,p_fingerprint,p_identity_key,
        p_encrypted_number->>'ciphertext',p_encrypted_number->>'iv',p_encrypted_number->>'tag',p_encrypted_number->>'key_id',p_risk_score)
      or c.version<>s.case_version or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id)
      or not internal.verification_artifacts_ready(s.id) then
      raise exception 'receipt retry conflicts with current submission' using errcode='PT409'; end if;
    return jsonb_build_object('submission_id',s.id,'case_version',s.case_version,'reused',true);
  end if;
  if c.version<>p_expected_version then raise exception 'case changed' using errcode='PT409'; end if;
  if not exists(select 1 from private.evidence_artifacts a where a.id=p_id_artifact and a.case_id=c.id and a.owner_id=subject
      and a.purpose='id_front' and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp()))
    or not exists(select 1 from private.evidence_artifacts a where a.id=p_selfie_artifact and a.case_id=c.id and a.owner_id=subject
      and a.purpose='selfie' and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp())) then
    raise exception 'clean subject-bound document and selfie required' using errcode='22023'; end if;
  if exists(select 1 from private.evidence_cases e where e.subject_id=subject and e.status='open' and e.kind in('kyc','business') and e.version=2147483647) then
    raise exception 'case revision exhausted' using errcode='22023'; end if;
  -- A typed-number/receipt replacement also invalidates other pending subject decisions.
  update private.evidence_cases set version=version+1 where subject_id=subject and status='open' and kind in('kyc','business');
  update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id=subject and revoked_at is null;
  insert into private.verification_identity_submissions(case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,
    identity_hmac,identity_key_id,number_ciphertext,number_iv,number_tag,encryption_key_id,receipt_id,recipe,risk_score)
  values(c.id,subject,c.version+1,p_id_artifact,p_selfie_artifact,p_fingerprint,p_identity_key,
    p_encrypted_number->>'ciphertext',p_encrypted_number->>'iv',p_encrypted_number->>'tag',p_encrypted_number->>'key_id',p_receipt,'manual-id-selfie-v1',p_risk_score)
  returning * into s;
  insert into private.verification_current_submissions(case_id,submission_id) values(c.id,s.id)
    on conflict(case_id) do update set submission_id=excluded.submission_id;
  return jsonb_build_object('submission_id',s.id,'case_version',s.case_version,'reused',false);
end;
$function$;
alter function internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) owner to postgres;
revoke all on function internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) from public;
grant execute on function internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) to service_role;
