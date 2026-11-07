-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reveal_post_phone(p_post_id uuid, p_channel text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reveal_post_phone(p_post_id,p_channel);
$function$;
alter function api.reveal_post_phone(uuid,text) owner to postgres;
revoke all on function api.reveal_post_phone(uuid,text) from public;
grant execute on function api.reveal_post_phone(uuid,text) to service_role;
