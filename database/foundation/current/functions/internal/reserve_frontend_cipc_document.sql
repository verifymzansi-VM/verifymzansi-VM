-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reserve_frontend_cipc_document(p_business uuid, p_number text, p_route text, p_office boolean, p_digest text, p_case uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();x private.frontend_business_checks;d private.frontend_cipc_reviews;
  art private.evidence_artifacts;prior private.frontend_cipc_documents;case_id uuid;
begin
  if p_number is null or p_number !~ '^[0-9]{4}/[0-9]{6}/[0-9]{2}$' or p_route is null or p_route not in('director','representative')
    or p_office is null or p_digest is null or p_digest !~ '^[0-9a-f]{64}$'
    then raise exception 'valid CIPC request required' using errcode='22023';end if;
  perform internal.lock_verification_subject(actor);actor:=internal.price_draft_actor();
  if not internal.frontend_business_identity_reviewed(actor) then raise exception 'reviewed owner identity required' using errcode='42501';end if;
  perform 1 from private.posts p where p.id=p_business and p.owner_id=actor and p.kind='business' and p.edit_of is null
    and p.status not in('archived','sold') for update;
  if not found then raise exception 'business unavailable' using errcode='PT404';end if;
  select * into x from private.frontend_business_checks b where b.business_id=p_business and b.kind in('cipc','cipc_link')
    and b.status in('pending','info_requested') for update;
  if x.id is null then
    if p_case is not null then raise exception 'represented CIPC case is closed' using errcode='PT409';end if;
    insert into private.evidence_cases(subject_id,kind) values(actor,'business') returning id into case_id;
    insert into private.frontend_business_checks(id,business_id,owner_id,kind) values(case_id,p_business,actor,'cipc') returning * into x;
    insert into private.frontend_cipc_reviews(check_id,registration_number,route,use_registered_office)
      values(x.id,p_number,p_route,p_office) returning * into d;
  else
    if x.kind<>'cipc' or x.owner_id<>actor or (p_case is not null and p_case<>x.id) then raise exception 'another business check is open' using errcode='PT409';end if;
    select * into d from private.frontend_cipc_reviews where check_id=x.id for update;
    if d.registration_number<>p_number or (p_case is null and (d.route<>p_route or d.use_registered_office<>p_office))
      then raise exception 'represented CIPC details changed' using errcode='PT409';end if;
  end if;
  select * into prior from private.frontend_cipc_documents e where e.check_id=x.id and e.source='owner_upload' and e.content_digest=p_digest;
  if found then
    if prior.recorded_at is not null and d.owner_file=prior.artifact_id then
      return jsonb_build_object('case_id',x.id,'artifact_id',prior.artifact_id,'owner_id',actor,'completed',true);
    elsif prior.recorded_at is not null or prior.reviewed_version<>x.updated_at then raise exception 'CIPC upload changed' using errcode='PT409';end if;
    return jsonb_build_object('case_id',x.id,'artifact_id',prior.artifact_id,'owner_id',actor,'completed',false);
  end if;
  if d.submitted_at is not null and p_case is null then raise exception 'this business already has a CIPC check in review' using errcode='PT409';end if;
  if (select count(*) from private.frontend_cipc_documents e where e.check_id=x.id and e.source='owner_upload')>=10
    then raise exception 'CIPC attachment limit reached' using errcode='PT429';end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(x.id,actor,'registration','evidence/'||x.id||'/'||gen_random_uuid()) returning * into art;
  insert into private.frontend_cipc_documents(artifact_id,check_id,actor_id,source,content_digest,reviewed_version)
    values(art.id,x.id,actor,'owner_upload',p_digest,x.updated_at);
  return jsonb_build_object('case_id',x.id,'artifact_id',art.id,'owner_id',actor,'completed',false);
end$function$;
alter function internal.reserve_frontend_cipc_document(uuid,text,text,boolean,text,uuid) owner to postgres;
revoke all on function internal.reserve_frontend_cipc_document(uuid,text,text,boolean,text,uuid) from public;
grant execute on function internal.reserve_frontend_cipc_document(uuid,text,text,boolean,text,uuid) to authenticated;
