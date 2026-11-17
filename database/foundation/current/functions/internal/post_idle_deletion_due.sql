-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_idle_deletion_due(p_post private.posts)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select (p_post.status in('draft','rejected') or (p_post.status='paused' and not exists(select 1 from private.post_activations a
      where a.post_id=p_post.id and a.released_at is null)))
    and greatest(p_post.content_updated_at,p_post.status_changed_at,(select max(h.released_at) from private.frontend_content_holds h
      where h.post_id=p_post.id))<=clock_timestamp()-interval '60 days'
    and not exists(select 1 from private.posts e where e.edit_of=p_post.id and (e.status='pending_moderation'
      or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days'));
$function$;
alter function internal.post_idle_deletion_due(private.posts) owner to postgres;
revoke all on function internal.post_idle_deletion_due(private.posts) from public;
