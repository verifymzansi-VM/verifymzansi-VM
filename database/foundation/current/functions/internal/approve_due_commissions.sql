-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.approve_due_commissions(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare c record; n integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'limit 1 to 1000' using errcode='22023'; end if;
  for c in select x.id,p.account_id from private.partner_commissions x
      join private.payments pay on pay.id=x.payment_id and pay.status='complete'
      join private.partners p on p.id=x.partner_id
      where x.status='pending' and x.eligible_at<=statement_timestamp()
      order by x.eligible_at,x.id limit p_limit for update of x skip locked loop
    update private.partner_commissions set status='approved',approved_at=statement_timestamp() where id=c.id;
    perform internal.notify_account(c.account_id,'partner_commission_approved',c.id,null,null);
    n:=n+1;
  end loop;
  return n;
end;
$function$;
alter function internal.approve_due_commissions(integer) owner to postgres;
revoke all on function internal.approve_due_commissions(integer) from public;
grant execute on function internal.approve_due_commissions(integer) to service_role;
