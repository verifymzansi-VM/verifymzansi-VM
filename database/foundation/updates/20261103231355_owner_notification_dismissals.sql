begin;
create table private.notification_dismissals (
  notification_id uuid primary key references private.notifications(id) on delete cascade,
  dismissed_at timestamptz not null default statement_timestamp()
);
alter table private.notification_dismissals enable row level security;
revoke all on private.notification_dismissals from public,anon,authenticated,service_role;

create function internal.dismiss_my_notifications(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); removed integer;
begin
  if p_ids is not null and (cardinality(p_ids) not between 1 and 100 or coalesce(array_ndims(p_ids),0)<>1 or array_position(p_ids,null) is not null) then
    raise exception 'invalid notification ids' using errcode='22023'; end if;
  insert into private.notification_dismissals(notification_id)
    select n.id from private.notifications n where n.account_id=actor and (p_ids is null or n.id=any(p_ids))
    on conflict do nothing;
  get diagnostics removed=row_count;
  update private.notifications n set read_at=statement_timestamp()
    where n.account_id=actor and n.read_at is null and exists(select 1 from private.notification_dismissals d where d.notification_id=n.id);
  perform internal.price_draft_actor();
  if removed>0 then perform internal.signal_owner_inbox(actor); end if;
  return jsonb_build_object('dismissed',removed,'unread_count',(select count(*) from private.notifications n where n.account_id=actor and n.read_at is null));
end;
$$;
revoke all on function internal.dismiss_my_notifications(uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.dismiss_my_notifications(uuid[]) to authenticated;
create function api.dismiss_my_notifications(p_ids uuid[] default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.dismiss_my_notifications(p_ids); $$;
revoke all on function api.dismiss_my_notifications(uuid[]) from public,anon,authenticated,service_role;
grant execute on function api.dismiss_my_notifications(uuid[]) to authenticated;

create function internal.list_my_frontend_notifications(p_limit integer,p_unread boolean,p_before timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_unread is null then raise exception 'invalid notification query' using errcode='22023'; end if;
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',n.id,'kind',n.kind,'post_id',n.post_id,'post_title',p.title,'organisation_name',o.name,'organisation_slug',o.slug,
    'created_at',n.created_at,'read_at',n.read_at) order by n.created_at desc,n.id desc)
    from (select * from private.notifications n where n.account_id=actor
      and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
      and (not p_unread or n.read_at is null) and (p_before is null or n.created_at<p_before)
      order by n.created_at desc,n.id desc limit p_limit) n
    left join private.posts p on p.id=n.post_id left join private.organisations o on o.id=n.organisation_id),'[]'::jsonb),
    'unread_count',(select count(*) from private.notifications n where n.account_id=actor and n.read_at is null)) into result;
  perform internal.price_draft_actor(); return result;
end;
$$;
revoke all on function internal.list_my_frontend_notifications(integer,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function internal.list_my_frontend_notifications(integer,boolean,timestamptz) to authenticated;
create function api.list_my_frontend_notifications(p_limit integer default 25,p_unread boolean default false,p_before timestamptz default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$ select internal.list_my_frontend_notifications(p_limit,p_unread,p_before); $$;
revoke all on function api.list_my_frontend_notifications(integer,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function api.list_my_frontend_notifications(integer,boolean,timestamptz) to authenticated;

-- Keep the existing native notification API coherent, without changing its DTO.
do $migration$
declare body text; marker text:=' and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)';
begin
  select prosrc into strict body from pg_proc where oid='internal.list_my_notifications(timestamptz,uuid,integer)'::regprocedure;
  if md5(body)<>'58fe62a1cdbff394516b565fe588870a' then raise exception 'Unknown notification list function'; end if;
  body:=replace(body,'n.account_id=actor','n.account_id=actor'||marker);
  body:=replace(body,'y.account_id=actor','y.account_id=actor and not exists(select 1 from private.notification_dismissals d where d.notification_id=y.id)');
  execute format('create or replace function internal.list_my_notifications(p_before_created timestamptz,p_before_id uuid,p_limit integer) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',body);
end;
$migration$;
commit;
