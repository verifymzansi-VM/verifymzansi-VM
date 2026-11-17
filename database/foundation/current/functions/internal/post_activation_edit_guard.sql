-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_activation_edit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if exists (select 1 from private.posts p where p.id = new.post_id and p.edit_of is not null) then
    raise exception 'an edit uses its live post''s funding' using errcode = '23514';
  end if;
  return new;
end;
$function$;
alter function internal.post_activation_edit_guard() owner to postgres;
revoke all on function internal.post_activation_edit_guard() from public;
