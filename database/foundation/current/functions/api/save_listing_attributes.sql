-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_listing_attributes(p_post_id uuid, p_expected_revision integer, p_attributes jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$ select internal.save_listing_attributes(p_post_id,p_expected_revision,p_attributes); $function$;
alter function api.save_listing_attributes(uuid,integer,jsonb) owner to postgres;
revoke all on function api.save_listing_attributes(uuid,integer,jsonb) from public;
grant execute on function api.save_listing_attributes(uuid,integer,jsonb) to authenticated;
