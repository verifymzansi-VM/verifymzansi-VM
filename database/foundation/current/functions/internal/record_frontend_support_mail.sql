-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_frontend_support_mail(p_ticket uuid, p_template text, p_accepted boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  insert into private.support_ticket_mail(ticket_id,template,accepted) values(p_ticket,p_template,p_accepted)
  on conflict(ticket_id,template) do nothing;
  return exists(select 1 from private.support_ticket_mail m where m.ticket_id=p_ticket and m.template=p_template and m.accepted=p_accepted);
end$function$;
alter function internal.record_frontend_support_mail(uuid,text,boolean) owner to postgres;
revoke all on function internal.record_frontend_support_mail(uuid,text,boolean) from public;
grant execute on function internal.record_frontend_support_mail(uuid,text,boolean) to service_role;
