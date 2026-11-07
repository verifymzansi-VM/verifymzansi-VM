-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.set_my_avatar(p_expected_revision integer, p_object_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_my_avatar(p_expected_revision,p_object_id);
$function$;
alter function api.set_my_avatar(integer,uuid) owner to postgres;
revoke all on function api.set_my_avatar(integer,uuid) from public;
grant execute on function api.set_my_avatar(integer,uuid) to authenticated;
