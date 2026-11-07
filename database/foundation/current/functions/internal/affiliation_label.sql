-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.affiliation_label(p_type text, p_wording text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case p_type when 'member' then 'Member' when 'affiliate' then 'Affiliated with' else p_wording end;
$function$;
alter function internal.affiliation_label(text,text) owner to postgres;
revoke all on function internal.affiliation_label(text,text) from public;
