-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.revoke_member_invitation(p_email text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.revoke_member_invitation(p_email);
$function$;
alter function api.revoke_member_invitation(text) owner to postgres;
revoke all on function api.revoke_member_invitation(text) from public;
grant execute on function api.revoke_member_invitation(text) to authenticated;
