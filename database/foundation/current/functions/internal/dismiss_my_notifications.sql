-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.dismiss_my_notifications(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.dismiss_my_notifications(uuid[]) owner to postgres;
revoke all on function internal.dismiss_my_notifications(uuid[]) from public;
grant execute on function internal.dismiss_my_notifications(uuid[]) to authenticated;
