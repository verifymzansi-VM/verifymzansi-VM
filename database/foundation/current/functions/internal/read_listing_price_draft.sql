-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.read_listing_price_draft()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,
    'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at)
    into result from private.listing_price_drafts d where d.owner_id=actor and d.expires_at>statement_timestamp();
  return result;
end;
$function$;
alter function internal.read_listing_price_draft() owner to postgres;
revoke all on function internal.read_listing_price_draft() from public;
grant execute on function internal.read_listing_price_draft() to authenticated;
