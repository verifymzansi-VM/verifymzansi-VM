-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_decide_commission(p_commission uuid, p_action text, p_reference text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('partner:manage'); c private.partner_commissions; owner uuid;
begin
  perform internal.organisation_reason(p_reason);
  select * into c from private.partner_commissions x where x.id=p_commission for update;
  if not found then raise exception 'commission not found' using errcode='PT404',detail='commission_unavailable'; end if;
  actor:=internal.staff_actor('partner:manage');
  select p.account_id into owner from private.partners p where p.id=c.partner_id;
  if owner=actor or c.referred_account_id=actor then
    raise exception 'staff cannot decide their own commission' using errcode='42501',detail='self_partner'; end if;
  if p_action='approve' then
    if c.status<>'pending' or c.eligible_at>statement_timestamp()
      or not exists(select 1 from private.payments pay where pay.id=c.payment_id and pay.status='complete') then
      raise exception 'commission is not due' using errcode='PT409',detail='commission_state'; end if;
    update private.partner_commissions set status='approved',approved_at=statement_timestamp(),approved_by=actor
      where id=c.id returning * into c;
    perform internal.notify_account(owner,'partner_commission_approved',c.id,null,null);
  elsif p_action='mark_paid' then
    if c.status<>'approved' then
      raise exception 'commission is not approved' using errcode='PT409',detail='commission_state'; end if;
    if p_reference is null or not internal.plain_text_valid(p_reference,3,120,false) then
      raise exception 'payout reference required' using errcode='22023',detail='commission_invalid'; end if;
    update private.partner_commissions set status='paid',paid_at=statement_timestamp(),paid_by=actor,
      paid_reference=p_reference where id=c.id returning * into c;
  elsif p_action='reverse' then
    if c.status='reversed' then
      raise exception 'commission already reversed' using errcode='PT409',detail='commission_state'; end if;
    update private.partner_commissions set status='reversed',reversed_at=statement_timestamp(),reversed_by=actor,
      reversal_reason=p_reason where id=c.id returning * into c;
    perform internal.notify_account(owner,'partner_commission_reversed',c.id,null,null);
  else
    raise exception 'unknown action' using errcode='22023',detail='commission_invalid';
  end if;
  insert into private.partner_events(partner_id,commission_id,actor_id,action,reason)
    values(c.partner_id,c.id,actor,'commission_'||p_action,p_reason);
  return jsonb_build_object('id',c.id,'status',c.status);
end;
$function$;
alter function internal.staff_decide_commission(uuid,text,text,text) owner to postgres;
revoke all on function internal.staff_decide_commission(uuid,text,text,text) from public;
grant execute on function internal.staff_decide_commission(uuid,text,text,text) to authenticated;
