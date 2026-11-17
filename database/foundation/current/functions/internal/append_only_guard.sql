-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.append_only_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op='DELETE' and current_setting('vm.retention',true)='on' then return old; end if;
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$function$;
alter function internal.append_only_guard() owner to postgres;
revoke all on function internal.append_only_guard() from public;
