-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.media_object_in_use(p_object_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare fk record; used boolean;
begin
  for fk in
    select c.conrelid::regclass::text as rel, c.conkey, n.nspname as schema_name, r.relname as table_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where c.contype = 'f' and c.confrelid = 'private.media_objects'::regclass
  loop
    if cardinality(fk.conkey) <> 1 then return true; end if;
    execute format('select exists (select 1 from %I.%I where %I = $1)', fk.schema_name, fk.table_name,
      (select a.attname from pg_catalog.pg_attribute a
        where a.attrelid = fk.rel::regclass and a.attnum = fk.conkey[1]))
      into used using p_object_id;
    if used then return true; end if;
  end loop;
  return false;
end;
$function$;
alter function internal.media_object_in_use(uuid) owner to postgres;
revoke all on function internal.media_object_in_use(uuid) from public;
