-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_activity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if exists (select 1 from private.categories c where c.key = new.category_key and c.activity_required)
    and new.activity_key is null then
    raise exception 'activity required for this category' using errcode = '23514';
  end if;
  return new;
end;
$function$;
alter function internal.post_activity_guard() owner to postgres;
revoke all on function internal.post_activity_guard() from public;
