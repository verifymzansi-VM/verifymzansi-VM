-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.confirm_verification_locality(p_province text, p_city text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.confirm_verification_locality(p_province,p_city);
$function$;
alter function api.confirm_verification_locality(text,text) owner to postgres;
revoke all on function api.confirm_verification_locality(text,text) from public;
grant execute on function api.confirm_verification_locality(text,text) to authenticated;
