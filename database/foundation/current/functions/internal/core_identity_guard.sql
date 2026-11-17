-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.core_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.owner_id,new.kind,new.area) is distinct from (old.id,old.owner_id,old.kind,old.area) then
    raise exception 'post identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.core_identity_guard() owner to postgres;
revoke all on function internal.core_identity_guard() from public;
