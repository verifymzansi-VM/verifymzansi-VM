-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.release_activation_on_post_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  update private.post_activations set released_at = statement_timestamp(), release_reason = 'deleted'
  where post_id = old.id and released_at is null;
  update private.post_addon_windows set revoked_at = clock_timestamp()
  where post_id = old.id and revoked_at is null;
  return old;
end;
$function$;
alter function internal.release_activation_on_post_delete() owner to postgres;
revoke all on function internal.release_activation_on_post_delete() from public;
