-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_my_enquiries(p_status text, p_before_created timestamp with time zone, p_before_id uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); items jsonb; last private.enquiries; unread integer;
begin
  perform internal.inbox_page_limit(p_limit,p_before_created,p_before_id);
  if p_status is not null and p_status not in('new','read','contacted','closed') then
    raise exception 'invalid inbox page' using errcode='22023',detail='inbox_page_invalid'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'post_id',x.post_id,'post_kind',p.kind,'post_title',p.title,
      'buyer_name',x.buyer_name,'buyer_email',x.buyer_email,'buyer_phone',x.buyer_phone,
      'email_confirmed',x.email_confirmed,'message',x.message,'status',x.status,'created_at',x.created_at,
      'updated_at',x.updated_at) order by x.created_at desc,x.id desc),'[]')
    into items
  from (select * from private.enquiries x where x.owner_id=actor and (p_status is null or x.status=p_status)
      and (p_before_created is null or (x.created_at,x.id)<(p_before_created,p_before_id))
      order by x.created_at desc,x.id desc limit p_limit) x
  join private.posts p on p.id=x.post_id;
  select x.* into last from private.enquiries x where x.owner_id=actor and (p_status is null or x.status=p_status)
    and (p_before_created is null or (x.created_at,x.id)<(p_before_created,p_before_id))
    order by x.created_at desc,x.id desc offset p_limit-1 limit 1;
  select count(*) into unread from private.enquiries x where x.owner_id=actor and x.status='new';
  return jsonb_build_object('items',items,'unread_count',unread,
    'next_cursor',case when last.id is not null and exists(select 1 from private.enquiries y where y.owner_id=actor
        and (p_status is null or y.status=p_status) and (y.created_at,y.id)<(last.created_at,last.id))
      then jsonb_build_object('before_created',last.created_at,'before_id',last.id) end);
end;
$function$;
alter function internal.list_my_enquiries(text,timestamp with time zone,uuid,integer) owner to postgres;
revoke all on function internal.list_my_enquiries(text,timestamp with time zone,uuid,integer) from public;
grant execute on function internal.list_my_enquiries(text,timestamp with time zone,uuid,integer) to authenticated;
