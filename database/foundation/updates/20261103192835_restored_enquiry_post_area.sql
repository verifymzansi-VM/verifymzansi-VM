-- An explicit presentation extension preserves the original inbox DTO while
-- adding the canonical area needed for Business/Tourism reply links.
begin;
create function internal.list_my_frontend_enquiries(p_status text,p_before_created timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb; items jsonb;
begin
  result:=internal.list_my_enquiries(p_status,p_before_created,p_before_id,p_limit);
  select coalesce(jsonb_agg(e.item||jsonb_build_object('post_area',p.area,'post_title',p.title,'post_kind',p.kind) order by e.position),'[]'::jsonb) into items
    from jsonb_array_elements(result->'items') with ordinality e(item,position)
    left join private.posts p on p.id=(e.item->>'post_id')::uuid and p.owner_id=actor;
  perform internal.price_draft_actor();
  return jsonb_set(result,'{items}',items);
end;
$$;
revoke all on function internal.list_my_frontend_enquiries(text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.list_my_frontend_enquiries(text,timestamptz,uuid,integer) to authenticated;
create function api.list_my_frontend_enquiries(p_limit integer default 25,p_status text default null,p_before_created timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.list_my_frontend_enquiries(p_status,p_before_created,p_before_id,p_limit);
$$;
revoke all on function api.list_my_frontend_enquiries(integer,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function api.list_my_frontend_enquiries(integer,text,timestamptz,uuid) to authenticated;
commit;
