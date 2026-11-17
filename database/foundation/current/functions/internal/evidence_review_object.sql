-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_review_object(p_case uuid, p_artifact uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare art private.evidence_artifacts; s private.verification_identity_submissions;
begin
  select a.* into art from private.evidence_artifacts a where a.id=p_artifact and a.case_id=p_case and a.state='clean'
    and (a.retain_until is null or a.retain_until>clock_timestamp());
  if not found then raise exception 'current artifact unavailable' using errcode='PT409'; end if;
  select x.* into s from private.verification_identity_submissions x join private.verification_current_submissions v on v.submission_id=x.id
    join private.evidence_cases c on c.id=x.case_id and c.version=x.case_version
    where v.case_id=p_case and p_artifact in(x.id_artifact_id,x.selfie_artifact_id);
  if not found then raise exception 'current identity submission unavailable' using errcode='PT409'; end if;
  return jsonb_build_object('artifact_id',art.id,'object_key',art.object_key,'sha256',art.sha256,'size_bytes',art.size_bytes,
    'owner_id',s.owner_id,'encrypted_number',jsonb_build_object('ciphertext',s.number_ciphertext,'iv',s.number_iv,'tag',s.number_tag,'key_id',s.encryption_key_id),
    'claimed_names',(select jsonb_build_object('first_name',n.legal_first_name,'last_name',n.legal_last_name)
      from private.identity_submission_names n where n.submission_id=s.id and n.owner_id=s.owner_id));
end;
$function$;
alter function internal.evidence_review_object(uuid,uuid) owner to postgres;
revoke all on function internal.evidence_review_object(uuid,uuid) from public;
grant execute on function internal.evidence_review_object(uuid,uuid) to service_role;
