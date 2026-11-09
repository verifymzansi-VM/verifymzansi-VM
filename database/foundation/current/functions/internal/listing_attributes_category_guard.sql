-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.listing_attributes_category_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare post private.posts; attrs jsonb;
begin
  select p.* into post from private.posts p where p.id=new.id for update;
  if not found or post.kind<>'listing' then return null; end if;
  select d.attributes into attrs from private.listing_details d where d.post_id=post.id;
  if found then perform internal.validate_listing_attributes(post.category_key,attrs,false); end if;
  return null;
end;
$function$;
alter function internal.listing_attributes_category_guard() owner to postgres;
revoke all on function internal.listing_attributes_category_guard() from public;
