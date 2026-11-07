-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_staff_rank(p_role text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case p_role when 'member' then 0 when 'moderator' then 1 when 'governor' then 2 when 'admin' then 3 end;
$function$;
alter function internal.frontend_staff_rank(text) owner to postgres;
revoke all on function internal.frontend_staff_rank(text) from public;
