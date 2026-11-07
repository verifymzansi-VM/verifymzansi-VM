-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.profile_public_name(p_display_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_display_name is null then null
    when strpos(p_display_name,' ')=0 then p_display_name
    else split_part(p_display_name,' ',1)||' '||left(regexp_replace(p_display_name,'^.* ',''),1)||'.' end;
$function$;
alter function internal.profile_public_name(text) owner to postgres;
revoke all on function internal.profile_public_name(text) from public;
