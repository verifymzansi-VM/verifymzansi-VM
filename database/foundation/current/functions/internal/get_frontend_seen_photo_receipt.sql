-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_seen_photo_receipt(p_case uuid, p_artifact uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim');x private.frontend_business_checks;p private.frontend_business_seen_photos;
begin
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('case:claim');
  if x.assigned_to is distinct from actor or x.owner_id=actor then raise exception 'current assigned verifier required' using errcode='42501';end if;
  select photo.* into p from private.frontend_business_seen_photos photo join private.evidence_artifacts a on a.id=photo.artifact_id
    where photo.check_id=x.id and photo.artifact_id=p_artifact and photo.verifier_id=actor and a.state='clean' and a.content_sha256=photo.content_digest;
  if not found then raise exception 'photo storage could not be confirmed' using errcode='PT409';end if;
  return jsonb_build_object('fileId',p.artifact_id,'by',actor,'takenAt',p.created_at,'lat',p.latitude,'lng',p.longitude);
end$function$;
alter function internal.get_frontend_seen_photo_receipt(uuid,uuid) owner to postgres;
revoke all on function internal.get_frontend_seen_photo_receipt(uuid,uuid) from public;
grant execute on function internal.get_frontend_seen_photo_receipt(uuid,uuid) to authenticated;
