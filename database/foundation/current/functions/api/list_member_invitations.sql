-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_member_invitations()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_member_invitations();
$function$;
alter function api.list_member_invitations() owner to postgres;
revoke all on function api.list_member_invitations() from public;
grant execute on function api.list_member_invitations() to authenticated;
