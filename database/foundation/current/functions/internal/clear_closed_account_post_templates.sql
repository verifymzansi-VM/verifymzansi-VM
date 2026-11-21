-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.clear_closed_account_post_templates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  delete from private.post_templates where owner_id = new.user_id;
  return null;
end;
$function$;
alter function internal.clear_closed_account_post_templates() owner to postgres;
revoke all on function internal.clear_closed_account_post_templates() from public;
