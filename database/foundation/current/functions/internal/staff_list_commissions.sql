-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_list_commissions(p_partner uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('partner:manage');
begin
  if p_status is not null and p_status not in('pending','approved','paid','reversed') then
    raise exception 'unknown status' using errcode='22023',detail='commission_invalid'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'partner_id',c.partner_id,'payment_id',c.payment_id,
      'base_cents',c.base_cents::text,'rate_bps',c.rate_bps,'amount_cents',c.amount_cents::text,'status',c.status,
      'eligible_at',c.eligible_at,'approved_at',c.approved_at,'paid_at',c.paid_at,'paid_reference',c.paid_reference,
      'reversed_at',c.reversed_at,'reversal_reason',c.reversal_reason,'created_at',c.created_at)
      order by c.created_at desc,c.id desc),'[]')
    from (select * from private.partner_commissions x where (p_partner is null or x.partner_id=p_partner)
      and (p_status is null or x.status=p_status) order by x.created_at desc,x.id desc limit 500) c);
end;
$function$;
alter function internal.staff_list_commissions(uuid,text) owner to postgres;
revoke all on function internal.staff_list_commissions(uuid,text) from public;
grant execute on function internal.staff_list_commissions(uuid,text) to authenticated;
