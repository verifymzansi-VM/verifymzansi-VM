-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.begin_identity_check_evidence(p_check uuid, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks; subject uuid; id_art private.evidence_artifacts; selfie_art private.evidence_artifacts;
begin
  if p_check is null or p_session_id is null then raise exception 'identity check session required' using errcode='22023'; end if;
  select x.owner_id into subject from private.identity_checks x where x.id=p_check;
  if not found then raise exception 'unfinished identity check required' using errcode='PT409'; end if;
  perform internal.lock_verification_subject(subject);
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if k.status<>'started' or k.session_id is distinct from p_session_id then
    raise exception 'unfinished identity check required' using errcode='PT409'; end if;
  if exists(select 1 from private.accepted_identity_facts f where f.owner_id=subject) then
    raise exception 'accepted identity requires authorised resubmission' using errcode='PT409'; end if;
  if exists(select 1 from private.decisions d where d.case_id=k.case_id and d.status='proposed'
      and d.action='approve_override' and d.payload ? 'identity_submission_id') then
    raise exception 'independent identity review is pending' using errcode='PT409'; end if;
  select a.* into id_art from private.evidence_artifacts a where a.id=k.id_artifact_id and a.state='intent'
    and a.created_at>clock_timestamp()-interval '30 minutes';
  select a.* into selfie_art from private.evidence_artifacts a where a.id=k.selfie_artifact_id and a.state='intent'
    and a.created_at>clock_timestamp()-interval '30 minutes';
  if id_art.id is null or selfie_art.id is null then
    insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
      values(k.case_id,subject,'id_front','evidence/'||k.case_id||'/'||pg_catalog.gen_random_uuid()) returning * into id_art;
    insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
      values(k.case_id,subject,'selfie','evidence/'||k.case_id||'/'||pg_catalog.gen_random_uuid()) returning * into selfie_art;
    update private.identity_checks set id_artifact_id=id_art.id,selfie_artifact_id=selfie_art.id where id=k.id;
  end if;
  return jsonb_build_object('id_front',jsonb_build_object('artifact_id',id_art.id,'object_key',id_art.object_key),
    'selfie',jsonb_build_object('artifact_id',selfie_art.id,'object_key',selfie_art.object_key),
    'owner_id',k.owner_id,
    'start',jsonb_build_object('first_name',k.start_first_name,'last_name',k.start_last_name,
      'network_hash',k.network_hash,'device_kind',k.device_kind));
end$function$;
alter function internal.begin_identity_check_evidence(uuid,uuid) owner to postgres;
revoke all on function internal.begin_identity_check_evidence(uuid,uuid) from public;
grant execute on function internal.begin_identity_check_evidence(uuid,uuid) to service_role;
