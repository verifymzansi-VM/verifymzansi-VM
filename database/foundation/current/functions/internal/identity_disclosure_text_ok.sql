-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_disclosure_text_ok(p_value text, p_min integer, p_max integer)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.privacy_text(p_value,p_min,p_max);
  return true;
exception when invalid_parameter_value then
  return false;
end;
$function$;
alter function internal.identity_disclosure_text_ok(text,integer,integer) owner to postgres;
revoke all on function internal.identity_disclosure_text_ok(text,integer,integer) from public;
