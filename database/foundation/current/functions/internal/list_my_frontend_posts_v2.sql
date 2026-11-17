-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_my_frontend_posts_v2(p_kind text, p_area text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();rows jsonb;total bigint;begin
  if p_kind is null or p_kind not in('listing','business','event') or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000 or (p_area is not null and p_area not in('market','business','tourism_events')) then
    raise exception 'bounded owner post query required' using errcode='22023'; end if;
  select count(*) into total from private.posts p where owner_id=actor and kind=p_kind and edit_of is null and (p_area is null or area=p_area);
  select coalesce(jsonb_agg(internal.frontend_owner_post_v2(p.id,actor) order by p.created_at desc,p.id),'[]'::jsonb) into rows
    from (select id,created_at from private.posts where owner_id=actor and kind=p_kind and edit_of is null and (p_area is null or area=p_area)
      order by created_at desc,id limit p_limit offset p_offset) p;
  perform internal.price_draft_actor();return jsonb_build_object('items',rows,'total',total,'limit',p_limit,'offset',p_offset);
end$function$;
alter function internal.list_my_frontend_posts_v2(text,text,integer,integer) owner to postgres;
revoke all on function internal.list_my_frontend_posts_v2(text,text,integer,integer) from public;
grant execute on function internal.list_my_frontend_posts_v2(text,text,integer,integer) to authenticated;
