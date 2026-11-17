-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_enquiry_status(p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); e private.enquiries;
begin
  if p_status is null or p_status not in('read','contacted','closed') then
    raise exception 'invalid enquiry status' using errcode='22023',detail='enquiry_status_invalid'; end if;
  select x.* into e from private.enquiries x where x.id=p_id and x.owner_id=actor for update;
  if not found then return null; end if;
  perform internal.price_draft_actor();
  if e.status<>p_status then
    update private.enquiries set status=p_status,updated_at=statement_timestamp() where id=e.id returning * into e;
    update private.notifications set read_at=statement_timestamp()
      where account_id=actor and kind='enquiry_received' and subject_id=e.id and read_at is null;
    perform internal.signal_owner_inbox(actor);
  end if;
  return jsonb_build_object('id',e.id,'status',e.status,'updated_at',e.updated_at);
end;
$function$;
alter function internal.set_enquiry_status(uuid,text) owner to postgres;
revoke all on function internal.set_enquiry_status(uuid,text) from public;
grant execute on function internal.set_enquiry_status(uuid,text) to authenticated;
