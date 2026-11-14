-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_reversal_waiting_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare payment uuid := (case when tg_table_name = 'payments' then to_jsonb(new)->>'id'
  else to_jsonb(new)->>'payment_id' end)::uuid;
begin
  if exists(select 1 from private.payment_refund_requests r
      where r.payment_id = payment and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if exists(select 1 from private.payment_refund_requests r
      where r.payment_id = payment and r.status in ('approved', 'sent')) then
    raise exception 'a refund of this payment is on its way through Ozow' using errcode='PT409', detail='refund_in_flight';
  end if;
  return new;
end;
$function$;
alter function internal.payment_reversal_waiting_guard() owner to postgres;
revoke all on function internal.payment_reversal_waiting_guard() from public;
