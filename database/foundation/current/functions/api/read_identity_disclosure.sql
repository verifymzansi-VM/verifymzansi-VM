-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.read_identity_disclosure(p_disclosure uuid, p_purpose text, p_subject uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.read_identity_disclosure(p_disclosure,p_purpose,p_subject);
$function$;
alter function api.read_identity_disclosure(uuid,text,uuid) owner to postgres;
revoke all on function api.read_identity_disclosure(uuid,text,uuid) from public;
grant execute on function api.read_identity_disclosure(uuid,text,uuid) to authenticated;
