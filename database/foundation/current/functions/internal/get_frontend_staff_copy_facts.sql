-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_copy_facts(p_posts uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('queue:view'); items jsonb;
begin
  if p_posts is null or cardinality(p_posts) > 25 then
    raise exception 'up to 25 posts' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'post_id', p.id,
      'copied_from', (select jsonb_build_object('id', c.source_post_id, 'title', s.title,
          'status', coalesce(s.status, 'deleted'))
        from private.post_copies c left join private.posts s on s.id = c.source_post_id where c.post_id = p.id),
      'same_photos', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'photos', o.n)
          order by o.n desc, o.id)
        from (select op.id, op.title, count(distinct m.sha256)::integer as n
          from private.post_media pm
          join private.media_objects m on m.id = pm.object_id
          join private.media_objects om on om.owner_id = p.owner_id and om.sha256 = m.sha256
          join private.post_media opm on opm.object_id = om.id and opm.purpose in ('cover', 'gallery')
          join private.posts op on op.id = opm.post_id
          where pm.post_id = p.id and pm.purpose in ('cover', 'gallery') and m.kind = 'image'
            and op.owner_id = p.owner_id and op.status = 'live' and op.id <> p.id
            and op.id is distinct from p.edit_of
          group by op.id, op.title
          order by n desc, op.id
          limit 10) o), '[]'::jsonb))
    order by p.id), '[]'::jsonb)
  into items
  from private.posts p
  where p.id = any(p_posts) and p.status = 'pending_moderation'
    and exists(select 1 from private.queue_claims q where q.post_id = p.id and q.claimed_by = actor
      and q.claim_expires_at > clock_timestamp());
  perform internal.staff_actor('queue:view');
  return jsonb_build_object('items', items);
end;
$function$;
alter function internal.get_frontend_staff_copy_facts(uuid[]) owner to postgres;
revoke all on function internal.get_frontend_staff_copy_facts(uuid[]) from public;
grant execute on function internal.get_frontend_staff_copy_facts(uuid[]) to authenticated;
