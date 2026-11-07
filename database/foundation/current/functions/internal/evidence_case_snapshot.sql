-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_case_snapshot(p_case uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'purpose',a.purpose,
    'object_key',a.object_key,'state',a.state,'sha256',a.sha256,'size_bytes',a.size_bytes)
    order by a.id),'[]'::jsonb)
  from private.evidence_artifacts a where a.case_id=p_case;
$function$;
alter function internal.evidence_case_snapshot(uuid) owner to postgres;
revoke all on function internal.evidence_case_snapshot(uuid) from public;
