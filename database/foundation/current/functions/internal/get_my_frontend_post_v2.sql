-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_frontend_post_v2(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();result jsonb;begin
  result:=internal.frontend_owner_post_v2(p_id,actor);perform internal.price_draft_actor();return result;
end$function$;
alter function internal.get_my_frontend_post_v2(uuid) owner to postgres;
revoke all on function internal.get_my_frontend_post_v2(uuid) from public;
grant execute on function internal.get_my_frontend_post_v2(uuid) to authenticated;
