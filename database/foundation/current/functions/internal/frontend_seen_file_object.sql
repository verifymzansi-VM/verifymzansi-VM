-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_seen_file_object(p_case uuid, p_artifact uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('object_key',a.object_key,'sha256',a.sha256,'content_sha256',a.content_sha256,
    'size_bytes',a.size_bytes,'mime',p.mime)
  from private.evidence_artifacts a join private.frontend_business_seen_files p on p.artifact_id=a.id and p.check_id=a.case_id
  where a.id=p_artifact and a.case_id=p_case and a.purpose in('business_visit_photo','business_reply_attachment','registration') and a.state='clean'
    and a.content_sha256=p.content_digest and (a.retain_until is null or a.retain_until>statement_timestamp());
$function$;
alter function internal.frontend_seen_file_object(uuid,uuid) owner to postgres;
revoke all on function internal.frontend_seen_file_object(uuid,uuid) from public;
grant execute on function internal.frontend_seen_file_object(uuid,uuid) to service_role;
