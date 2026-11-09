-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_support_inbox(p_page integer DEFAULT 1, p_ticket uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('support:view');answer jsonb;can_update boolean;
begin
  if p_page is null or p_page not between 1 and 100000 then raise exception 'valid support page required' using errcode='22023';end if;
  can_update:=exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='support:update'
    where s.user_id=actor and s.revoked_at is null);
  with scope as (
    select * from private.support_tickets t where p_ticket is null or t.id=p_ticket
  ), rows as (
    select * from scope order by created_at desc,id desc limit 50 offset case when p_ticket is null then (p_page-1)*50 else 0 end
  )
  select jsonb_build_object('actor_id',actor,'total',(select count(*) from scope),'can_update',can_update,
    'new_count',(select count(*) from private.support_tickets where status='new'),
    'oldest_new_at',(select min(created_at) from private.support_tickets where status='new'),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'email',t.email,
      'message','['||t.category||'] '||t.message,'status',t.status,'revision',t.revision,'created_at',t.created_at,
      'emailActivity',coalesce((select jsonb_agg(jsonb_build_object('template',m.template,'accepted',m.accepted,'created_at',m.created_at)
        order by m.created_at,m.template) from private.support_ticket_mail m where m.ticket_id=t.id),'[]'::jsonb))
      order by t.created_at desc,t.id desc) from rows t),'[]'::jsonb)) into answer;
  perform internal.staff_actor('support:view');return answer;
end$function$;
alter function internal.get_frontend_support_inbox(integer,uuid) owner to postgres;
revoke all on function internal.get_frontend_support_inbox(integer,uuid) from public;
grant execute on function internal.get_frontend_support_inbox(integer,uuid) to authenticated;
