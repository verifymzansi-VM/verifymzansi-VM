-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.require_table_rls()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare created record;
begin
  for created in select c.object_identity from pg_catalog.pg_event_trigger_ddl_commands() c
    where c.command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') and c.object_type = 'table'
      and c.schema_name in ('public', 'api', 'private', 'internal')
  loop
    execute pg_catalog.format('alter table %s enable row level security', created.object_identity);
  end loop;
  if exists (select 1 from pg_catalog.pg_class t join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      where t.relkind in ('r', 'p') and n.nspname in ('public', 'api', 'private', 'internal')
        and not t.relrowsecurity) then
    raise exception 'row level security is required on application tables' using errcode = '42501';
  end if;
end;
$function$;
alter function internal.require_table_rls() owner to postgres;
revoke all on function internal.require_table_rls() from public;
