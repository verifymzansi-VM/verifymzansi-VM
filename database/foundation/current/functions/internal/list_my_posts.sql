-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_my_posts(p_limit integer DEFAULT 48, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'invalid page' using errcode='22023'; end if;
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'kind',p.kind,'area',p.area,'category',p.category_key,'title',p.title,
    'status',p.status,'revision',p.revision,'created_at',p.created_at,
    'published_at',p.published_at,'visible_until',p.visible_until,
    'price_mode',d.price_mode,'price_cents',d.price_cents::text,
    'cover_object_key',(select m.object_key from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=p.id and m.state='ready' and m.kind='image' order by (pm.purpose='cover') desc,pm.position limit 1)
    ) order by p.created_at desc,p.id desc) from (select * from private.posts
      where owner_id=actor and edit_of is null order by created_at desc,id desc limit p_limit offset p_offset) p
      left join private.post_search_documents d on d.post_id=p.id),'[]'::jsonb),
    'total',(select count(*) from private.posts where owner_id=actor and edit_of is null),
    'limit',p_limit,'offset',p_offset) into result;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.list_my_posts(integer,integer) owner to postgres;
revoke all on function internal.list_my_posts(integer,integer) from public;
grant execute on function internal.list_my_posts(integer,integer) to authenticated;
