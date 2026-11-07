-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.mark_evidence_deleted(p_artifact uuid, p_claim_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare art private.evidence_artifacts;
begin
  select a.* into art from private.evidence_artifacts a where a.id=p_artifact;
  if not found or p_claim_token is null then raise exception 'cleanup claim required' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(art.owner_id);
  if exists(select 1 from private.legal_holds h where h.subject_id=art.owner_id and h.released_at is null) or internal.evidence_fraud_held(art.case_id) then raise exception 'hold prevents deletion' using errcode='PT409'; end if;
  if art.state='deleted' and art.cleanup_token=p_claim_token then return true; end if;
  update private.evidence_artifacts set state='deleted',deleted_at=statement_timestamp() where id=p_artifact and state='cleanup_required' and cleanup_token=p_claim_token and cleanup_lease_until>statement_timestamp();
  if not found then raise exception 'cleanup claim expired' using errcode='PT409'; end if;
  return true;
end;
$function$;
alter function internal.mark_evidence_deleted(uuid,uuid) owner to postgres;
revoke all on function internal.mark_evidence_deleted(uuid,uuid) from public;
grant execute on function internal.mark_evidence_deleted(uuid,uuid) to service_role;
