-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_my_frontend_notices(p_limit integer, p_unread boolean, p_before timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_unread is null then raise exception 'invalid notification query' using errcode='22023'; end if;
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',n.id,'kind',n.kind,'post_id',n.post_id,'post_title',p.title,'organisation_name',o.name,'organisation_slug',o.slug,
    'warning_reason',case when n.kind='account_warning' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where w.account_id=actor and r.id=n.subject_id) end,'created_at',n.created_at,'read_at',n.read_at) order by n.created_at desc,n.id desc)
    from (select * from private.notifications n where n.account_id=actor and (n.kind<>'account_warning' or exists(
    select 1 from private.frontend_account_warnings w where w.account_id=actor and w.receipt_id=n.subject_id))
      and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
      and (not p_unread or n.read_at is null) and (p_before is null or n.created_at<p_before)
      order by n.created_at desc,n.id desc limit p_limit) n
    left join private.posts p on p.id=n.post_id left join private.organisations o on o.id=n.organisation_id),'[]'::jsonb),
    'unread_count',(select count(*) from private.notifications n where n.account_id=actor and (n.kind<>'account_warning' or exists(
    select 1 from private.frontend_account_warnings w where w.account_id=actor and w.receipt_id=n.subject_id)) and n.read_at is null)) into result;
  perform internal.price_draft_actor(); return result;
end;
$function$;
alter function internal.list_my_frontend_notices(integer,boolean,timestamp with time zone) owner to postgres;
revoke all on function internal.list_my_frontend_notices(integer,boolean,timestamp with time zone) from public;
grant execute on function internal.list_my_frontend_notices(integer,boolean,timestamp with time zone) to authenticated;
