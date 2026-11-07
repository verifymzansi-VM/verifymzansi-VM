-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.update_frontend_support_status(p_ticket uuid, p_revision integer, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('support:update');x private.support_tickets;
begin
  if p_revision is null or p_revision not between 1 and 2147483646 or p_status is null or p_status not in('new','in_progress','resolved')
    then raise exception 'represented support status required' using errcode='22023';end if;
  select * into x from private.support_tickets where id=p_ticket for update;
  actor:=internal.staff_actor('support:update');
  if not found or x.revision<>p_revision then raise exception 'support ticket changed' using errcode='PT409';end if;
  if x.status<>p_status then
    update private.support_tickets set status=p_status,revision=revision+1 where id=x.id returning * into x;
    insert into private.support_ticket_events(ticket_id,revision,actor_id,status) values(x.id,x.revision,actor,x.status);
  end if;
  perform internal.staff_actor('support:update');
  return jsonb_build_object('id',x.id,'status',x.status,'revision',x.revision);
end$function$;
alter function internal.update_frontend_support_status(uuid,integer,text) owner to postgres;
revoke all on function internal.update_frontend_support_status(uuid,integer,text) from public;
grant execute on function internal.update_frontend_support_status(uuid,integer,text) to authenticated;
