-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.listing_attributes_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare category text;
begin
  select p.category_key into category from private.posts p where p.id=new.post_id;
  if new.attributes_version<>1 then raise exception 'unsupported attribute version' using errcode='23514'; end if;
  new.attributes:=internal.validate_listing_attributes(category,new.attributes,false);
  return new;
end;
$function$;
alter function internal.listing_attributes_guard() owner to postgres;
revoke all on function internal.listing_attributes_guard() from public;
