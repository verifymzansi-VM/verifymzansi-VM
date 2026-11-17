-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reserve_frontend_seen_reply_file(p_business uuid, p_case uuid, p_digest text, p_mime text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();x private.frontend_business_checks;art private.evidence_artifacts;prior private.frontend_business_reply_files;
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_mime is null or p_mime not in('image/jpeg','image/png','image/webp','application/pdf')
    then raise exception 'valid business check attachment required' using errcode='22023';end if;
  perform internal.lock_verification_subject(actor);actor:=internal.price_draft_actor();
  select b.* into x from private.frontend_business_checks b join private.posts p on p.id=b.business_id and p.owner_id=b.owner_id
    join private.evidence_cases c on c.id=b.id and c.status='open'
    where b.id=p_case and b.business_id=p_business and b.owner_id=actor and b.kind='seen' and b.status in('pending','info_requested') for update of b;
  if not found then raise exception 'open business check not found' using errcode='PT404';end if;
  select * into prior from private.frontend_business_reply_files f where f.check_id=x.id and f.content_digest=p_digest;
  if found then
    select * into art from private.evidence_artifacts where id=prior.artifact_id;
    if prior.mime<>p_mime or art.state not in('intent','uploaded','clean') then raise exception 'attachment is no longer available' using errcode='PT409';end if;
    return jsonb_build_object('artifact_id',art.id,'owner_id',actor,'completed',art.state='clean');
  end if;
  if (select count(*) from private.frontend_business_reply_files where check_id=x.id)>=20 then raise exception 'attachment limit reached' using errcode='PT429';end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(x.id,actor,'business_reply_attachment','evidence/'||x.id||'/'||gen_random_uuid()) returning * into art;
  insert into private.frontend_business_reply_files(artifact_id,check_id,content_digest,mime) values(art.id,x.id,p_digest,p_mime);
  return jsonb_build_object('artifact_id',art.id,'owner_id',actor,'completed',false);
end$function$;
alter function internal.reserve_frontend_seen_reply_file(uuid,uuid,text,text) owner to postgres;
revoke all on function internal.reserve_frontend_seen_reply_file(uuid,uuid,text,text) from public;
grant execute on function internal.reserve_frontend_seen_reply_file(uuid,uuid,text,text) to authenticated;
