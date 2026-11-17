-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_owner_post_v2(p_post uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.frontend_owner_post(p.id,p_actor)||jsonb_build_object('deletes_at',p.deletes_at)
  from private.posts p where p.id=p_post and p.owner_id=p_actor;
$function$;
alter function internal.frontend_owner_post_v2(uuid,uuid) owner to postgres;
revoke all on function internal.frontend_owner_post_v2(uuid,uuid) from public;
