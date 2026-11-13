-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_delivery_commission(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; acq private.account_acquisitions; partner private.partners; rate integer; made integer := 0;
begin
  select * into pay from private.payments p where p.id = p_payment_id;
  if not found or pay.status <> 'complete' or pay.fulfillment_status <> 'fulfilled' then return 0; end if;
  select * into acq from private.account_acquisitions a where a.account_id = pay.owner_id;
  if acq.partner_id is null then return 0; end if;
  select * into partner from private.partners p where p.id = acq.partner_id;
  if partner.status <> 'active' or partner.account_id = pay.owner_id then return 0; end if;
  rate := coalesce(partner.commission_bps, 2000);
  if exists(select 1 from private.payment_lines l where l.payment_id = pay.id) then
    insert into private.partner_commissions(partner_id, payment_id, payment_line_id, referred_account_id, base_cents, rate_bps,
        amount_cents, eligible_at)
      select partner.id, pay.id, l.id, pay.owner_id, l.amount_cents, rate, floor(l.amount_cents::numeric*rate/10000),
        statement_timestamp()+interval '30 days'
      from private.payment_lines l where l.payment_id = pay.id and l.status = 'open' order by l.line_number
      on conflict (payment_line_id) where payment_line_id is not null do nothing;
  else
    insert into private.partner_commissions(partner_id, payment_id, referred_account_id, base_cents, rate_bps, amount_cents,
        eligible_at)
      values(partner.id, pay.id, pay.owner_id, pay.amount_cents, rate, floor(pay.amount_cents::numeric*rate/10000),
        statement_timestamp()+interval '30 days')
      on conflict (payment_id) where payment_line_id is null do nothing;
  end if;
  get diagnostics made = row_count;
  return made;
end;
$function$;
alter function internal.payment_delivery_commission(uuid) owner to postgres;
revoke all on function internal.payment_delivery_commission(uuid) from public;
