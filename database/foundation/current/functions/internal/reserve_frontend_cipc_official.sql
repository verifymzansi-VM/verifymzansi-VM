-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reserve_frontend_cipc_official(p_case uuid, p_expected timestamp with time zone, p_generation text, p_nonce uuid, p_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view');x private.frontend_business_checks;art private.evidence_artifacts;
  prior private.frontend_cipc_documents;c private.evidence_cases;
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'official PDF digest required' using errcode='22023';end if;
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.staff_actor('evidence:view');
  if x.kind<>'cipc' or x.owner_id=actor then raise exception 'independent official copy review required' using errcode='42501';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  if x.updated_at is distinct from p_expected or not exists(select 1 from private.frontend_cipc_reviews d where d.check_id=x.id and d.submitted_at is not null)
    then raise exception 'CIPC check changed' using errcode='PT409';end if;
  select * into prior from private.frontend_cipc_documents d where d.check_id=x.id and d.source='admin_copy' and d.content_digest=p_digest;
  if found then
    if prior.actor_id is distinct from actor or (prior.recorded_at is null and (prior.reviewed_version<>x.updated_at or prior.claim_generation<>p_generation or prior.claim_nonce<>p_nonce))
      then raise exception 'official copy scope changed' using errcode='PT409';end if;
    if prior.recorded_at is not null and not exists(select 1 from private.frontend_cipc_reviews d where d.check_id=x.id and d.official_file=prior.artifact_id)
      then raise exception 'this official copy is superseded' using errcode='PT409';end if;
    return jsonb_build_object('case_id',x.id,'artifact_id',prior.artifact_id,'owner_id',x.owner_id,'completed',prior.recorded_at is not null);
  end if;
  if (select count(*) from private.frontend_cipc_documents d where d.check_id=x.id and d.source='admin_copy')>=10
    then raise exception 'official copy attachment limit reached' using errcode='PT429';end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(x.id,x.owner_id,'registration','evidence/'||x.id||'/'||gen_random_uuid()) returning * into art;
  insert into private.frontend_cipc_documents(artifact_id,check_id,actor_id,source,content_digest,reviewed_version,claim_generation,claim_nonce)
    values(art.id,x.id,actor,'admin_copy',p_digest,x.updated_at,p_generation,p_nonce);
  return jsonb_build_object('case_id',x.id,'artifact_id',art.id,'owner_id',x.owner_id,'completed',false);
end$function$;
alter function internal.reserve_frontend_cipc_official(uuid,timestamp with time zone,text,uuid,text) owner to postgres;
revoke all on function internal.reserve_frontend_cipc_official(uuid,timestamp with time zone,text,uuid,text) from public;
grant execute on function internal.reserve_frontend_cipc_official(uuid,timestamp with time zone,text,uuid,text) to authenticated;
