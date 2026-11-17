-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.begin_evidence_upload(p_case_id uuid, p_purpose text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); art private.evidence_artifacts;
begin
  perform internal.lock_evidence_subject(actor);
  actor:=internal.price_draft_actor();
  if exists(select 1 from private.evidence_cases c where c.id=p_case_id and c.subject_id=actor and c.kind='kyc')
    and p_purpose in('id_front','id_back','selfie') then
    if exists(select 1 from private.accepted_identity_facts f where f.owner_id=actor) then
      raise exception 'accepted identity requires authorised resubmission' using errcode='PT409'; end if;
    if exists(select 1 from private.decisions d where d.case_id=p_case_id and d.status='proposed'
      and d.action='approve_override' and d.payload ? 'identity_submission_id') then
      raise exception 'independent identity review is pending' using errcode='PT409'; end if;
  end if;
  perform c.id from private.evidence_cases c where c.id=p_case_id and c.subject_id=actor and c.status='open'
    and c.kind in('kyc','business') for update;
  if not found then
    raise exception 'case not open for this member' using errcode = '22023';
  end if;
  if exists (select 1 from private.account_closures x where x.user_id = actor) then
    raise exception 'account is closed' using errcode = '42501';
  end if;
  if (select count(*) from private.evidence_artifacts a where a.case_id = p_case_id and a.state = 'intent') >= 5 then
    raise exception 'too many unfinished uploads' using errcode = 'PT429';
  end if;
  insert into private.evidence_artifacts (case_id, owner_id, purpose, object_key)
  values (p_case_id, actor, p_purpose, 'evidence/' || p_case_id || '/' || pg_catalog.gen_random_uuid())
  returning * into art;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('artifact_id', art.id, 'state', art.state);
end;
$function$;
alter function internal.begin_evidence_upload(uuid,text) owner to postgres;
revoke all on function internal.begin_evidence_upload(uuid,text) from public;
grant execute on function internal.begin_evidence_upload(uuid,text) to authenticated;
