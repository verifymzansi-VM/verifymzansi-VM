-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.start_checkout(p_product_id uuid, p_target_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_checkout(p_product_id, p_target_post);
$function$;
alter function api.start_checkout(uuid,uuid) owner to postgres;
revoke all on function api.start_checkout(uuid,uuid) from public;
grant execute on function api.start_checkout(uuid,uuid) to authenticated;
