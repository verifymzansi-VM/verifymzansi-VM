-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.advance_evidence_artifact(p_artifact_id uuid, p_state text, p_sha256 text DEFAULT NULL::text, p_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_state='deleted' then raise exception 'use a current cleanup claim to acknowledge deletion' using errcode='22023'; end if;
  return internal.advance_evidence_artifact(p_artifact_id,p_state,p_sha256,p_size);
end;
$function$;
alter function api.advance_evidence_artifact(uuid,text,text,integer) owner to postgres;
revoke all on function api.advance_evidence_artifact(uuid,text,text,integer) from public;
grant execute on function api.advance_evidence_artifact(uuid,text,text,integer) to service_role;
