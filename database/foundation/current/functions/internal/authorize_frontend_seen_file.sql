-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.authorize_frontend_seen_file(p_artifact uuid, p_record boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view');subject uuid;check_id uuid;x private.frontend_business_checks;c private.evidence_cases;
begin
  select b.id,b.owner_id into check_id,subject from private.frontend_business_seen_files ph join private.frontend_business_checks b on b.id=ph.check_id
    where ph.artifact_id=p_artifact;
  if subject is null then raise exception 'photo not available' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);actor:=internal.staff_actor('evidence:view');
  select * into x from private.frontend_business_checks where id=check_id;
  select * into c from private.evidence_cases where id=check_id;
  if actor=subject or not coalesce(actor=x.assigned_to or actor=x.reviewed_by
    or (c.status='open' and c.claimed_by=actor and c.claim_expires_at>clock_timestamp()),false)
    then raise exception 'an authorized verifier must view this photo' using errcode='42501';end if;
  if not exists(select 1 from private.evidence_artifacts a where a.id=p_artifact and a.case_id=c.id and a.state='clean'
      and (a.retain_until is null or a.retain_until>clock_timestamp()))
    then raise exception 'photo not available' using errcode='PT404';end if;
  if p_record then
    insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
      values(actor,c.id,'routine_review',c.version,c.claim_generation,array[p_artifact]);
  end if;
  perform internal.staff_actor('evidence:view');return jsonb_build_object('case_id',c.id,'version',c.version,'artifact_id',p_artifact);
end$function$;
alter function internal.authorize_frontend_seen_file(uuid,boolean) owner to postgres;
revoke all on function internal.authorize_frontend_seen_file(uuid,boolean) from public;
grant execute on function internal.authorize_frontend_seen_file(uuid,boolean) to authenticated;
