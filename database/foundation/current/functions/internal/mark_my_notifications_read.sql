-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.mark_my_notifications_read(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); changed integer; unread integer;
begin
  if p_ids is not null and (cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null) then
    raise exception 'invalid notification ids' using errcode='22023',detail='notification_ids_invalid'; end if;
  update private.notifications set read_at=statement_timestamp()
    where account_id=actor and read_at is null and (p_ids is null or id=any(p_ids));
  get diagnostics changed=row_count;
  select count(*) into unread from private.notifications n where n.account_id=actor and n.read_at is null;
  if changed>0 then perform internal.signal_owner_inbox(actor); end if;
  return jsonb_build_object('marked',changed,'unread_count',unread);
end;
$function$;
alter function internal.mark_my_notifications_read(uuid[]) owner to postgres;
revoke all on function internal.mark_my_notifications_read(uuid[]) from public;
grant execute on function internal.mark_my_notifications_read(uuid[]) to authenticated;
