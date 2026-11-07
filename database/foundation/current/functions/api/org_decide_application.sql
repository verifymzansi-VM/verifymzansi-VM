-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.org_decide_application(p_application uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.org_decide_application(p_application,p_decision,p_note);
$function$;
alter function api.org_decide_application(uuid,text,text) owner to postgres;
revoke all on function api.org_decide_application(uuid,text,text) from public;
grant execute on function api.org_decide_application(uuid,text,text) to authenticated;
