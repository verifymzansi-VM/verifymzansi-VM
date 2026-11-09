-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.send_frontend_seen_message(p_case uuid, p_body text, p_business uuid DEFAULT NULL::uuid, p_artifact uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid;subject uuid;x private.frontend_business_checks;c private.evidence_cases;body_text text;
begin
  if p_business is null then actor:=internal.staff_actor('evidence:view');else actor:=internal.price_draft_actor();end if;
  body_text:=internal.privacy_text(coalesce(nullif(btrim(p_body),''),case when p_artifact is not null then 'Attached a file.' end),1,2000);
  select owner_id into subject from private.frontend_business_checks where id=p_case and (kind='seen' or exists(select 1 from private.frontend_cipc_reviews d where d.check_id=p_case and d.submitted_at is not null));
  if subject is null then raise exception 'business check unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);
  select * into c from private.evidence_cases where id=p_case and status='open' for update;
  select * into x from private.frontend_business_checks where id=p_case and status in('pending','info_requested') for update;
  if c.id is null or x.id is null or not exists(select 1 from private.posts p where p.id=x.business_id and p.owner_id=subject)
    then raise exception 'business check is no longer open' using errcode='PT409';end if;
  if p_business is not null then
    actor:=internal.price_draft_actor();
    if actor<>subject or x.business_id<>p_business then raise exception 'business check unavailable' using errcode='PT404';end if;
    if p_artifact is not null then
      if not exists(select 1 from (select artifact_id,check_id,content_digest from private.frontend_business_reply_files
      union all select d.artifact_id,d.check_id,d.content_digest from private.frontend_cipc_documents d
        join private.frontend_cipc_reviews r on r.check_id=d.check_id and r.owner_file=d.artifact_id
        where d.source='owner_upload' and d.recorded_at is not null)f join private.evidence_artifacts a on a.id=f.artifact_id
        where f.check_id=x.id and f.artifact_id=p_artifact and a.owner_id=actor and a.state='clean' and a.content_sha256=f.content_digest)
        then raise exception 'confirmed owner attachment required' using errcode='PT409';end if;
      if exists(select 1 from private.frontend_business_check_messages m where m.attachment_file_id=p_artifact) then
        if exists(select 1 from private.frontend_business_check_messages m where m.attachment_file_id=p_artifact and m.author_id=actor and m.body=body_text)
          then return jsonb_build_object('ok',true);end if;
        raise exception 'attachment is already part of another message' using errcode='PT409';
      end if;
    end if;
    insert into private.frontend_business_check_messages(check_id,author_id,author_role,body,attachment_file_id) values(x.id,actor,'owner',body_text,p_artifact);
    update private.frontend_business_checks set status='pending',updated_at=clock_timestamp() where id=x.id;
    perform internal.price_draft_actor();
  else
    if p_artifact is not null then raise exception 'staff message attachments are not accepted here' using errcode='22023';end if;
    actor:=internal.staff_actor('evidence:view');
    if actor=subject or not coalesce(x.assigned_to=actor or (c.claimed_by=actor and c.claim_expires_at>clock_timestamp()),false)
      then raise exception 'assigned or claimed independent staff required' using errcode='42501';end if;
    insert into private.frontend_business_check_messages(check_id,author_id,author_role,body) values(x.id,actor,'staff',body_text);
    perform internal.staff_actor('evidence:view');
  end if;
  return jsonb_build_object('ok',true);
end$function$;
alter function internal.send_frontend_seen_message(uuid,text,uuid,uuid) owner to postgres;
revoke all on function internal.send_frontend_seen_message(uuid,text,uuid,uuid) from public;
grant execute on function internal.send_frontend_seen_message(uuid,text,uuid,uuid) to authenticated;
