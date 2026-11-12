-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_partner_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare acq private.account_acquisitions; partner private.partners; c record; rate integer;
begin
  if new.status in('refunded','chargeback') then
    for c in select x.id,p.account_id from private.partner_commissions x join private.partners p on p.id=x.partner_id
        where x.payment_id=new.id and x.status<>'reversed' for update of x loop
      update private.partner_commissions set status='reversed',reversed_at=statement_timestamp(),
        reversal_reason='Payment '||new.status where id=c.id;
      perform internal.notify_account(c.account_id,'partner_commission_reversed',c.id,null,null);
    end loop;
    return null;
  end if;
  -- Only a delivered purchase earns commission: money sent to staff for
  -- reconciliation (needs_reconciliation) earns none.
  if new.status<>'complete' or new.fulfillment_status<>'fulfilled' then return null; end if;
  select * into acq from private.account_acquisitions a where a.account_id=new.owner_id;
  if acq.partner_id is null then return null; end if;
  select * into partner from private.partners p where p.id=acq.partner_id;
  if partner.status<>'active' or partner.account_id=new.owner_id then return null; end if;
  rate:=coalesce(partner.commission_bps,2000);
  if exists(select 1 from private.payment_lines l where l.payment_id=new.id) then
    insert into private.partner_commissions(partner_id,payment_id,payment_line_id,referred_account_id,base_cents,rate_bps,
        amount_cents,eligible_at)
      select partner.id,new.id,l.id,new.owner_id,l.amount_cents,rate,floor(l.amount_cents::numeric*rate/10000),
        statement_timestamp()+interval '30 days'
      from private.payment_lines l where l.payment_id=new.id and l.status='open' order by l.line_number
      on conflict (payment_line_id) where payment_line_id is not null do nothing;
  else
    insert into private.partner_commissions(partner_id,payment_id,referred_account_id,base_cents,rate_bps,amount_cents,
        eligible_at)
      values(partner.id,new.id,new.owner_id,new.amount_cents,rate,floor(new.amount_cents::numeric*rate/10000),
        statement_timestamp()+interval '30 days')
      on conflict (payment_id) where payment_line_id is null do nothing;
  end if;
  return null;
end;
$function$;
alter function internal.payment_partner_commission() owner to postgres;
revoke all on function internal.payment_partner_commission() from public;
