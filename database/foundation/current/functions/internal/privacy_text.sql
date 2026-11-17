-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.privacy_text(p_value text, p_min integer, p_max integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare clean text:=btrim(p_value);
begin
  if clean is null or length(clean) not between p_min and p_max
    or clean ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]'
    then raise exception 'check the request text' using errcode='22023';end if;
  return clean;
end$function$;
alter function internal.privacy_text(text,integer,integer) owner to postgres;
revoke all on function internal.privacy_text(text,integer,integer) from public;
