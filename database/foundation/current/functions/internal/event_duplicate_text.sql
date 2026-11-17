-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.event_duplicate_text(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  select btrim(regexp_replace(lower(pg_catalog.normalize(p_value,'NFC')),
    U&'[ \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'));
$function$;
alter function internal.event_duplicate_text(text) owner to postgres;
revoke all on function internal.event_duplicate_text(text) from public;
