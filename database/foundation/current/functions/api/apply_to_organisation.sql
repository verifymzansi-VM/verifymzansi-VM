-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.apply_to_organisation(p_org uuid, p_post_id uuid, p_share_representative_name boolean, p_consent boolean, p_programme uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_member_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.apply_to_organisation(p_org,p_programme,p_post_id,p_reason,p_member_reference,
    p_share_representative_name,p_consent);
$function$;
alter function api.apply_to_organisation(uuid,uuid,boolean,boolean,uuid,text,text) owner to postgres;
revoke all on function api.apply_to_organisation(uuid,uuid,boolean,boolean,uuid,text,text) from public;
grant execute on function api.apply_to_organisation(uuid,uuid,boolean,boolean,uuid,text,text) to authenticated;
