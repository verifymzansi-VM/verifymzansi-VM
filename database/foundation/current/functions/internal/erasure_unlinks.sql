-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.erasure_unlinks(p_old jsonb, p_new jsonb, p_columns text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(pg_catalog.current_setting('vm.erasure', true), '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p_columns is not null and cardinality(p_columns) > 0
    and (p_old - p_columns) = (p_new - p_columns)
    and not exists (select 1 from pg_catalog.unnest(p_columns) c
      where (p_new -> c) is distinct from (p_old -> c)
        and ((p_new ->> c) is not null
          or (p_old ->> c) is distinct from pg_catalog.current_setting('vm.erasure', true)))
    and exists (select 1 from pg_catalog.unnest(p_columns) c
      where (p_old ->> c) = pg_catalog.current_setting('vm.erasure', true) and (p_new ->> c) is null);
$function$;
alter function internal.erasure_unlinks(jsonb,jsonb,text[]) owner to postgres;
revoke all on function internal.erasure_unlinks(jsonb,jsonb,text[]) from public;
