-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.guard_consent_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'DELETE' and (pg_catalog.current_setting('vm.retention', true) = 'on'
      or not exists (select 1 from auth.users u where u.id = old.account_id)) then
    return old;
  end if;
  raise exception 'consent records are history; record a new choice instead' using errcode='23514';
end;
$function$;
alter function internal.guard_consent_record() owner to postgres;
revoke all on function internal.guard_consent_record() from public;
