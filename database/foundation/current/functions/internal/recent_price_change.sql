-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.recent_price_change(p_post_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select exists(select 1 from private.moderation_log l where l.post_id=p_post_id and l.price_only and l.decision='approve' and l.decided_at>statement_timestamp()-interval '24 hours')
   or exists(select 1 from private.frontend_offline_post_reviews r where r.post_id=p_post_id and r.price_only and r.decided_at>statement_timestamp()-interval '24 hours');
$function$;
alter function internal.recent_price_change(uuid) owner to postgres;
revoke all on function internal.recent_price_change(uuid) from public;
