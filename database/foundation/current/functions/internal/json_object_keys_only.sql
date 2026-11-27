-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.json_object_keys_only(p_value jsonb, p_keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select case when jsonb_typeof(p_value)='object' then
   (select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) from jsonb_each(p_value) e where e.key=any(p_keys))
 end;
$function$;
alter function internal.json_object_keys_only(jsonb,text[]) owner to postgres;
revoke all on function internal.json_object_keys_only(jsonb,text[]) from public;
