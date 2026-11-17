-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_listing_attributes(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'revision',p.revision,'category_key',p.category_key,'attributes_version',d.attributes_version,'attributes',d.attributes)
    into result from private.posts p join private.listing_details d on d.post_id=p.id where p.id=p_post_id and p.owner_id=actor and p.kind='listing';
  return result;
end;
$function$;
alter function internal.get_listing_attributes(uuid) owner to postgres;
revoke all on function internal.get_listing_attributes(uuid) from public;
grant execute on function internal.get_listing_attributes(uuid) to authenticated;
