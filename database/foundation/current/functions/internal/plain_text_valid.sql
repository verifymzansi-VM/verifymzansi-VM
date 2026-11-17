-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.plain_text_valid(p_value text, p_min integer, p_max integer, p_multiline boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_value is not null and char_length(p_value) between p_min and p_max
    and p_value is nfc normalized
    and p_value=btrim(p_value,' '||chr(10))
    and p_value !~ ('['||chr(1)||'-'||chr(9)||chr(11)||'-'||chr(31)||chr(127)||'-'||chr(159)||chr(173)
      ||chr(1564)||chr(6158)||chr(8203)||'-'||chr(8207)||chr(8232)||'-'||chr(8238)||chr(8288)||'-'||chr(8303)
      ||chr(65279)||chr(65529)||'-'||chr(65531)||']')
    and (p_multiline or strpos(p_value,chr(10))=0);
$function$;
alter function internal.plain_text_valid(text,integer,integer,boolean) owner to postgres;
revoke all on function internal.plain_text_valid(text,integer,integer,boolean) from public;
