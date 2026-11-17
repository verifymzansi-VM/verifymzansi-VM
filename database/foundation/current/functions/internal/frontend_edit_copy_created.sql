-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_edit_copy_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$begin
  if new.edit_of is not null then perform internal.copy_frontend_post_presentation(new.edit_of,new.id); end if; return new;
end$function$;
alter function internal.frontend_edit_copy_created() owner to postgres;
revoke all on function internal.frontend_edit_copy_created() from public;
