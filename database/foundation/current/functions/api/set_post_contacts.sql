-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.set_post_contacts(p_post_id uuid, p_expected_revision integer, p_channels jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_post_contacts(p_post_id,p_expected_revision,p_channels);
$function$;
alter function api.set_post_contacts(uuid,integer,jsonb) owner to postgres;
revoke all on function api.set_post_contacts(uuid,integer,jsonb) from public;
grant execute on function api.set_post_contacts(uuid,integer,jsonb) to authenticated;
