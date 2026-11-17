-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.organisation_reason(p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if not internal.plain_text_valid(p_reason,5,500,true) then
    raise exception 'a reason of 5 to 500 characters is required' using errcode='22023',detail='reason_required'; end if;
end;
$function$;
alter function internal.organisation_reason(text) owner to postgres;
revoke all on function internal.organisation_reason(text) from public;
