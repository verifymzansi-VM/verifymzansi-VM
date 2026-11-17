-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.approved_edit_count(p_post_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select ((select count(*) from private.moderation_log l where l.post_id=p_post_id and l.edit_id is not null and l.decision='approve' and not l.price_only)
   +(select count(*) from private.frontend_offline_post_reviews r where r.post_id=p_post_id and not r.price_only))::integer;
$function$;
alter function internal.approved_edit_count(uuid) owner to postgres;
revoke all on function internal.approved_edit_count(uuid) from public;
