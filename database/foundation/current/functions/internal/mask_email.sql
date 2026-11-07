-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.mask_email(p_email text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select left(p_email,1)||'***@'||split_part(p_email,'@',2);
$function$;
alter function internal.mask_email(text) owner to postgres;
revoke all on function internal.mask_email(text) from public;
