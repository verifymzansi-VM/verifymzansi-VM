-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_ozow_refund_checks(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare claimed jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'invalid refund check limit' using errcode='22023';
  end if;
  with due as (
    select r.id from private.payment_refund_requests r
    where (r.ozow_checked_at is null or r.ozow_checked_at <= statement_timestamp() - interval '30 minutes')
      and ((r.channel = 'api' and r.status = 'sent' and r.sent_at <= statement_timestamp() - interval '10 minutes'
          and not (r.ozow_refund_id is null and r.send_outcome = 'unknown' and r.send_attempts < 3
            and r.sent_at > statement_timestamp() - interval '6 hours'))
        or (r.channel = 'dashboard' and r.status in ('awaiting_approval', 'applied')
          and r.requested_at > statement_timestamp() - interval '30 days' and r.ozow_missing_at is null
          and (r.ozow_status is null or r.ozow_status not in ('Complete', 'Failed', 'Cancelled', 'Returned', 'Invalid',
            'Error'))))
    -- Refunds through Ozow first: dashboard records never hold them back.
    order by (r.channel = 'api') desc, coalesce(r.ozow_checked_at, r.requested_at), r.id
    limit p_limit
    for update skip locked),
  taken as (
    update private.payment_refund_requests r set ozow_checked_at = statement_timestamp()
    from due where r.id = due.id
    returning r.*)
  select coalesce(jsonb_agg(jsonb_build_object('request_id', t.id, 'ozow_refund_id', t.ozow_refund_id,
      'transaction_id', t.ozow_transaction_id, 'amount_cents', t.amount_cents, 'sent_at', t.sent_at) order by t.id),
    '[]'::jsonb)
    into claimed from taken t;
  return claimed;
end;
$function$;
alter function internal.claim_ozow_refund_checks(integer) owner to postgres;
revoke all on function internal.claim_ozow_refund_checks(integer) from public;
grant execute on function internal.claim_ozow_refund_checks(integer) to service_role;
