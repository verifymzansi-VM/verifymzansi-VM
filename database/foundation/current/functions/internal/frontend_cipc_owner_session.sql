-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_cipc_owner_session(p_actor uuid, p_session uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from auth.sessions s join private.current_account_access a on a.id=s.user_id
    where s.id=p_session and s.user_id=p_actor and (s.not_after is null or s.not_after>clock_timestamp()));
$function$;
alter function internal.frontend_cipc_owner_session(uuid,uuid) owner to postgres;
revoke all on function internal.frontend_cipc_owner_session(uuid,uuid) from public;
