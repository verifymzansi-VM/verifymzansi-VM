-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.core_listing_price_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare post uuid; category text; mode text; negotiable boolean;
begin
  if tg_table_name='posts' then post:=new.id; else post:=new.post_id; end if;
  select p.category_key into category from private.posts p where p.id=post and p.kind='listing' for update;
  if not found then return null; end if;
  select d.price_mode,d.price_negotiable into mode,negotiable from private.listing_details d where d.post_id=post;
  if category='jobs_services' and (mode='free' or negotiable) then
    raise exception 'job salary cannot be free or negotiable' using errcode='23514';
  end if;
  return null;
end;
$function$;
alter function internal.core_listing_price_guard() owner to postgres;
revoke all on function internal.core_listing_price_guard() from public;
