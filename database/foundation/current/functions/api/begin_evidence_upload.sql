-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.begin_evidence_upload(p_case_id uuid, p_purpose text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.begin_evidence_upload(p_case_id, p_purpose);
$function$;
alter function api.begin_evidence_upload(uuid,text) owner to postgres;
revoke all on function api.begin_evidence_upload(uuid,text) from public;
grant execute on function api.begin_evidence_upload(uuid,text) to authenticated;
