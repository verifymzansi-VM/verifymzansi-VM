-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_report_deferred(p_post private.posts)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.reports r where r.post_id=p_post.id and r.status='open')
    and clock_timestamp()<coalesce(p_post.deletes_at,greatest(p_post.content_updated_at,p_post.status_changed_at,
      (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p_post.id))+interval '60 days')
      +interval '7 days';
$function$;
alter function internal.post_report_deferred(private.posts) owner to postgres;
revoke all on function internal.post_report_deferred(private.posts) from public;
