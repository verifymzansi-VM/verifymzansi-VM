-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_first_purchase_refund(p_payment_id uuid, p_asked_on date)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
begin
  select * into pay from private.payments p where p.id = p_payment_id;
  if pay.owner_id is null then
    raise exception 'the account that paid was erased, so its first purchase cannot be checked'
      using errcode='PT409', detail='first_purchase_account_erased';
  end if;
  if not internal.payment_is_first_purchase(pay.id) then
    raise exception 'this is not the account''s first purchase' using errcode='PT409', detail='first_purchase_not_first';
  end if;
  if p_asked_on is null then
    raise exception 'the date the customer asked in writing is required' using errcode='22023',
      detail='first_purchase_asked_on_required';
  end if;
  if p_asked_on < (pay.completed_at at time zone 'Africa/Johannesburg')::date or p_asked_on > today then
    raise exception 'the date the customer asked must be between the day the payment was confirmed and today'
      using errcode='22023', detail='first_purchase_asked_on_invalid';
  end if;
  if p_asked_on > internal.first_purchase_last_ask_day(pay.completed_at) then
    raise exception 'the customer asked after the 5 business days for cancelling a first purchase'
      using errcode='PT409', detail='first_purchase_too_late';
  end if;
end;
$function$;
alter function internal.assert_first_purchase_refund(uuid,date) owner to postgres;
revoke all on function internal.assert_first_purchase_refund(uuid,date) from public;
