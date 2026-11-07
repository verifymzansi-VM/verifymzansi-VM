-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.advance_evidence_artifact(p_artifact_id uuid, p_state text, p_sha256 text, p_size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare art private.evidence_artifacts; subject uuid; case_id uuid;
begin
  select a.owner_id,a.case_id into subject,case_id from private.evidence_artifacts a where a.id=p_artifact_id;
  if not found then raise exception 'artifact not found' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  perform c.id from private.evidence_cases c where c.id=case_id for update;
  select * into art from private.evidence_artifacts a where a.id = p_artifact_id for update;
  if not found then raise exception 'artifact not found' using errcode = '22023'; end if;
  if p_sha256 is not null and p_sha256 !~ '^[a-f0-9]{64}$'
    or p_size is not null and p_size not between 1 and 20000000 then
    raise exception 'valid digest and bounded size required' using errcode='22023';
  end if;
  if (p_sha256 is not null and art.sha256 is not null and p_sha256 is distinct from art.sha256)
    or (p_size is not null and art.size_bytes is not null and p_size is distinct from art.size_bytes) then
    raise exception 'artifact metadata conflicts with stored upload' using errcode='PT409';
  end if;
  if p_state = 'deleted' and exists (select 1 from private.legal_holds h
      where h.subject_id = art.owner_id and h.released_at is null) then
    raise exception 'legal hold blocks deletion' using errcode = '23514';
  end if;
  update private.evidence_artifacts set state = p_state,
    sha256 = coalesce(sha256, p_sha256), size_bytes = coalesce(size_bytes, p_size),
    deleted_at = case when p_state = 'deleted' then statement_timestamp() end
  where id = art.id returning * into art;
  return jsonb_build_object('artifact_id', art.id, 'state', art.state);
end;
$function$;
alter function internal.advance_evidence_artifact(uuid,text,text,integer) owner to postgres;
revoke all on function internal.advance_evidence_artifact(uuid,text,text,integer) from public;
grant execute on function internal.advance_evidence_artifact(uuid,text,text,integer) to service_role;
