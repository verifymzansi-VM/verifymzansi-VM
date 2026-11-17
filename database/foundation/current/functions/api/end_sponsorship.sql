-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.end_sponsorship(p_sponsorship uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.end_sponsorship(p_sponsorship,p_reason);
$function$;
alter function api.end_sponsorship(uuid,text) owner to postgres;
revoke all on function api.end_sponsorship(uuid,text) from public;
grant execute on function api.end_sponsorship(uuid,text) to authenticated;
