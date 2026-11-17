-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.outbox_skip_unlinked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only payment notices can lose their person (a kept payment of an erased
  -- account); any other email without one is still an error.
  if new.owner_id is null and new.kind like 'payment\_%' then return null; end if;
  return new;
end;
$function$;
alter function internal.outbox_skip_unlinked() owner to postgres;
revoke all on function internal.outbox_skip_unlinked() from public;
