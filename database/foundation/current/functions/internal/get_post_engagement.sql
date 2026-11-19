-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_post_engagement(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_post_ids is null or cardinality(p_post_ids) > 50 or array_position(p_post_ids, null) is not null then
    raise exception 'engagement request is invalid' using errcode='22023', detail='engagement_invalid';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('post_id', d.post_id,
        'views', coalesce(t.views, 0), 'likes', coalesce(t.likes, 0)) order by d.post_id)
    from private.post_search_documents d
    left join private.post_engagement_totals t on t.post_id = d.post_id
    where d.post_id = any(p_post_ids) and d.is_visible
      and (d.visible_until is null or d.visible_until > statement_timestamp())
      and exists(select 1 from private.public_eligible_posts e where e.id = d.post_id)), '[]'::jsonb));
end;
$function$;
alter function internal.get_post_engagement(uuid[]) owner to postgres;
revoke all on function internal.get_post_engagement(uuid[]) from public;
grant execute on function internal.get_post_engagement(uuid[]) to anon;
grant execute on function internal.get_post_engagement(uuid[]) to authenticated;
