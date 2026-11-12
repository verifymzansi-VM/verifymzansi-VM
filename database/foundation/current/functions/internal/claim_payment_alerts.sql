-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_payment_alerts(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare now_at timestamptz := clock_timestamp(); token uuid; claimed jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid payment alert limit' using errcode='22023'; end if;
  -- A batch whose send failed (its lease ended or was given back) is offered
  -- again first, unchanged: same token, same rows, same stored details.
  select p.alert_claim into token from private.payment_problems p
    where p.needs_alert and p.alerted_at is null and p.alert_claim is not null
      and p.alert_claimed_until<=now_at and p.alert_raised_at>now_at-interval '7 days'
    order by p.alert_raised_at, p.id
    limit 1;
  if token is not null then
    with taken as (
      update private.payment_problems p set alert_claimed_until=now_at+interval '5 minutes'
        where p.alert_claim=token and p.needs_alert and p.alerted_at is null and p.alert_claimed_until<=now_at
        returning p.*)
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'payment_id',t.payment_id,'reason',t.reason,
        'source',t.source,'raised_at',t.alert_raised_at)||t.alert_snapshot order by t.alert_raised_at, t.id),'[]'::jsonb)
      into claimed from taken t;
  else
    -- A new batch: marked, not emailed, raised in the last 7 days and never
    -- prepared, oldest first. Rows another transaction holds are left for the
    -- next run. The payment's state is stored with each row once, here.
    token := pg_catalog.gen_random_uuid();
    with due as (
      select p.id from private.payment_problems p
      where p.needs_alert and p.alerted_at is null and p.alert_claim is null
        and p.alert_raised_at>now_at-interval '7 days'
      order by p.alert_raised_at, p.id
      limit p_limit
      for update skip locked),
    taken as (
      update private.payment_problems p set alert_claim=token,
          alert_claimed_until=now_at+interval '5 minutes',
          alert_snapshot=jsonb_build_object('merchant_reference',pay.merchant_reference,
            'amount_cents',pay.amount_cents::text,'status',pay.status,
            'fulfillment_status',pay.fulfillment_status,'product_kind',pay.product_kind)
        from due, private.payments pay
        where p.id=due.id and pay.id=p.payment_id
        returning p.*)
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'payment_id',t.payment_id,'reason',t.reason,
        'source',t.source,'raised_at',t.alert_raised_at)||t.alert_snapshot order by t.alert_raised_at, t.id),'[]'::jsonb)
      into claimed from taken t;
  end if;
  return jsonb_build_object('claim',case when jsonb_array_length(claimed)=0 then null else token end,
    'problems',claimed);
end;
$function$;
alter function internal.claim_payment_alerts(integer) owner to postgres;
revoke all on function internal.claim_payment_alerts(integer) from public;
grant execute on function internal.claim_payment_alerts(integer) to service_role;
