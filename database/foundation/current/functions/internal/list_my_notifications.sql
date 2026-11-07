-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_my_notifications(p_before_created timestamp with time zone, p_before_id uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); items jsonb; last private.notifications; unread integer;
begin
  perform internal.inbox_page_limit(p_limit,p_before_created,p_before_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'post_id',n.post_id,'post_title',p.title,
      'organisation_name',o.name,'created_at',n.created_at,'read_at',n.read_at) order by n.created_at desc,n.id desc),'[]')
    into items
  from (select * from private.notifications n where n.account_id=actor and n.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update') and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
      and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
      order by n.created_at desc,n.id desc limit p_limit) n
  left join private.posts p on p.id=n.post_id
  left join private.organisations o on o.id=n.organisation_id;
  select n.* into last from private.notifications n where n.account_id=actor and n.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update') and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
    and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
    order by n.created_at desc,n.id desc offset p_limit-1 limit 1;
  select count(*) into unread from private.notifications n where n.account_id=actor and n.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update') and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id) and n.read_at is null;
  return jsonb_build_object('items',items,'unread_count',unread,
    'next_cursor',case when last.id is not null and exists(select 1 from private.notifications y where y.account_id=actor and y.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update') and not exists(select 1 from private.notification_dismissals d where d.notification_id=y.id)
        and (y.created_at,y.id)<(last.created_at,last.id))
      then jsonb_build_object('before_created',last.created_at,'before_id',last.id) end);
end;
$function$;
alter function internal.list_my_notifications(timestamp with time zone,uuid,integer) owner to postgres;
revoke all on function internal.list_my_notifications(timestamp with time zone,uuid,integer) from public;
grant execute on function internal.list_my_notifications(timestamp with time zone,uuid,integer) to authenticated;
