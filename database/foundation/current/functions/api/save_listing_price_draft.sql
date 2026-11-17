-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_listing_price_draft(p_expected_revision integer, p_category_key text, p_terms jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_listing_price_draft(p_expected_revision,p_category_key,p_terms);
$function$;
alter function api.save_listing_price_draft(integer,text,jsonb) owner to postgres;
revoke all on function api.save_listing_price_draft(integer,text,jsonb) from public;
grant execute on function api.save_listing_price_draft(integer,text,jsonb) to authenticated;
