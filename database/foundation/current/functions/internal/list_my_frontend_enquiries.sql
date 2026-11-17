-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_my_frontend_enquiries(p_status text, p_before_created timestamp with time zone, p_before_id uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb; items jsonb;
begin
  result:=internal.list_my_enquiries(p_status,p_before_created,p_before_id,p_limit);
  select coalesce(jsonb_agg(e.item||jsonb_build_object('post_area',p.area,'post_title',p.title,'post_kind',p.kind) order by e.position),'[]'::jsonb) into items
    from jsonb_array_elements(result->'items') with ordinality e(item,position)
    left join private.posts p on p.id=(e.item->>'post_id')::uuid and p.owner_id=actor;
  perform internal.price_draft_actor();
  return jsonb_set(result,'{items}',items);
end;
$function$;
alter function internal.list_my_frontend_enquiries(text,timestamp with time zone,uuid,integer) owner to postgres;
revoke all on function internal.list_my_frontend_enquiries(text,timestamp with time zone,uuid,integer) from public;
grant execute on function internal.list_my_frontend_enquiries(text,timestamp with time zone,uuid,integer) to authenticated;
