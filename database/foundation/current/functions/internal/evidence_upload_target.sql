-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_upload_target(p_owner uuid, p_artifact uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare art private.evidence_artifacts;
begin
  select a.* into art from private.evidence_artifacts a join private.evidence_cases c on c.id=a.case_id
    where a.id=p_artifact and a.owner_id=p_owner and a.state='intent' and c.status='open'
      and exists(select 1 from private.current_account_access u where u.id=p_owner);
  if not found then raise exception 'owned pending artifact required' using errcode='42501'; end if;
  return jsonb_build_object('artifact_id',art.id,'case_id',art.case_id,'object_key',art.object_key,'purpose',art.purpose);
end;
$function$;
alter function internal.evidence_upload_target(uuid,uuid) owner to postgres;
revoke all on function internal.evidence_upload_target(uuid,uuid) from public;
grant execute on function internal.evidence_upload_target(uuid,uuid) to service_role;
