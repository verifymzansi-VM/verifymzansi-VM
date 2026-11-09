-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_my_legal_name(p_expected_revision integer, p_first_name text, p_last_name text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_my_legal_name(p_expected_revision,p_first_name,p_last_name);
$function$;
alter function api.save_my_legal_name(integer,text,text) owner to postgres;
revoke all on function api.save_my_legal_name(integer,text,text) from public;
grant execute on function api.save_my_legal_name(integer,text,text) to authenticated;
