-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_post_revision(p_revision integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_revision is null or p_revision not between 1 and 2147483646 then
    raise exception 'positive expected revision required' using errcode='22023';
  end if;
end;
$function$;
alter function internal.assert_post_revision(integer) owner to postgres;
revoke all on function internal.assert_post_revision(integer) from public;
