-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.catalogue_version_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'catalogue versions are retained' using errcode = '23514';
  end if;
  if (to_jsonb(new) - 'retired_at') is distinct from (to_jsonb(old) - 'retired_at')
    or (old.retired_at is not null and new.retired_at is distinct from old.retired_at) then
    raise exception 'catalogue versions are immutable; publish a new version' using errcode = '23514';
  end if;
  return new;
end;
$function$;
alter function internal.catalogue_version_guard() owner to postgres;
revoke all on function internal.catalogue_version_guard() from public;
