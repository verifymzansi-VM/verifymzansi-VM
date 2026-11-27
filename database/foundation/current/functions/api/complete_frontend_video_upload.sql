-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.complete_frontend_video_upload(p_object_id uuid, p_size integer, p_sha256 text, p_mime text, p_duration_ms integer, p_facts jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_frontend_video_upload(p_object_id,p_size,p_sha256,p_mime,p_duration_ms,p_facts)
$function$;
alter function api.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) owner to postgres;
revoke all on function api.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) from public;
grant execute on function api.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) to service_role;
