-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.set_post_like(p_post_id uuid, p_device uuid, p_account uuid DEFAULT NULL::uuid, p_liked boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_post_like(p_post_id, p_device, p_account, p_liked);
$function$;
alter function api.set_post_like(uuid,uuid,uuid,boolean) owner to postgres;
revoke all on function api.set_post_like(uuid,uuid,uuid,boolean) from public;
grant execute on function api.set_post_like(uuid,uuid,uuid,boolean) to service_role;
