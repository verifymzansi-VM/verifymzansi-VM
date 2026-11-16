-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reconcile_ozow_refunds(p_refunds jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare item jsonb; request private.payment_refund_requests; unmatched integer := 0; mismatched integer := 0;
  stuck integer := 0; checked integer := 0;
begin
  if jsonb_typeof(p_refunds) is distinct from 'array' or jsonb_array_length(p_refunds) > 2000 then
    raise exception 'up to 2000 Ozow refunds required' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_refunds) loop
    if not internal.valid_ozow_refund_fact(item) then
      raise exception 'valid Ozow refund required' using errcode='22023';
    end if;
    checked := checked + 1;
    select * into request from private.payment_refund_requests r
      where r.ozow_refund_id = (item->>'refund_id')::uuid
        or (r.channel = 'manual' and lower(r.ozow_reference) = item->>'refund_id')
      order by (r.status = 'declined'), r.requested_at desc limit 1;
    if found then
      -- Known, but Ozow's transaction or amount differs, or Ozow paid (or is
      -- paying) a refund whose record was declined or failed.
      if (request.channel <> 'manual' and (request.ozow_transaction_id is distinct from (item->>'transaction_id')::uuid
            or request.amount_cents <> (item->>'amount_cents')::bigint))
          or (request.channel = 'manual'
            and internal.ozow_refund_transaction(request.payment_id) is distinct from (item->>'transaction_id')::uuid)
          or (request.status in ('declined', 'failed')
            and item->>'status' not in ('Failed', 'Cancelled', 'Invalid', 'Error')) then
        mismatched := mismatched + 1;
        perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', 'refund_check', request.id::text);
      elsif request.status in ('awaiting_approval', 'applied')
          and item->>'status' in ('Failed', 'Cancelled', 'Invalid', 'Error', 'Returned') then
        -- A refund recorded as made (or waiting to take effect) that Ozow
        -- did not pay, or whose money came back.
        mismatched := mismatched + 1;
        perform internal.ozow_refund_problem(request.payment_id,
          case when item->>'status' = 'Returned' then 'refund_returned' else 'refund_failed' end, 'refund_check',
          request.id::text);
      end if;
    elsif internal.ozow_refund_link_candidate((item->>'refund_id')::uuid, (item->>'transaction_id')::uuid,
        (item->>'amount_cents')::bigint, (item->>'requested_at')::timestamptz) is null then
      unmatched := unmatched + 1;
      perform internal.ozow_refund_problem(internal.ozow_transaction_payment((item->>'transaction_id')::uuid),
        'refund_unmatched', 'refund_check', item->>'refund_id');
    end if;
  end loop;
  for request in select r.* from private.payment_refund_requests r
      where r.channel = 'api' and ((r.status = 'approved' and r.approved_at < statement_timestamp() - interval '1 day')
        or (r.status = 'sent' and r.sent_at < statement_timestamp() - interval '1 day'))
      order by r.requested_at, r.id loop
    stuck := stuck + 1;
    perform internal.ozow_refund_problem(request.payment_id, 'refund_stuck', 'refund_check', request.id::text);
  end loop;
  return jsonb_build_object('checked', checked, 'unmatched', unmatched, 'mismatched', mismatched, 'stuck', stuck);
end;
$function$;
alter function internal.reconcile_ozow_refunds(jsonb) owner to postgres;
revoke all on function internal.reconcile_ozow_refunds(jsonb) from public;
grant execute on function internal.reconcile_ozow_refunds(jsonb) to service_role;
