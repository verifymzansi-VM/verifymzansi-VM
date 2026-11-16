-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_invoice_payments(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  if p_payment_ids is null or cardinality(p_payment_ids) > 50 or array_position(p_payment_ids, null) is not null then
    raise exception 'up to 50 payment ids required' using errcode='22023';
  end if;
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object('payment_id', t.payment_id,
      'bank_reference', t.bank_reference, 'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'),
      'amount_received_cents', t.amount_received_cents, 'recorded_at', t.recorded_at,
      'recorded_by_me', internal.same_identity(t.recorded_by, actor),
      'confirmed_by_me', internal.same_identity(t.confirmed_by, actor), 'reason', t.reason)
      order by t.recorded_at desc, t.payment_id), '[]'::jsonb))
    into result
  from private.invoice_transfers t where t.payment_id = any (p_payment_ids);
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_invoice_payments(uuid[]) owner to postgres;
revoke all on function internal.get_staff_invoice_payments(uuid[]) from public;
grant execute on function internal.get_staff_invoice_payments(uuid[]) to authenticated;
