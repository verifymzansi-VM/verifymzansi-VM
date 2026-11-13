-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_activation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- An activation is an audit record: it never changes.
  raise exception 'payment activations are immutable' using errcode='23514';
end;
$function$;
alter function internal.payment_activation_guard() owner to postgres;
revoke all on function internal.payment_activation_guard() from public;
